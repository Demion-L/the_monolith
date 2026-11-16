/**
 * Canonical location of the operational state (BETA-020 Phase 2).
 *
 * ONE REPOSITORY. ONE OPERATIONAL STATE. MANY AGENTS.
 *
 * Default (`state.mode: "shared"`): `<git-common-dir>/monolith/state.json`. Every
 * worktree of a repository resolves the same git common directory, so they all
 * share one file, one revision and one lock. `.git` may be a file in a linked
 * worktree; only `git rev-parse --git-common-dir` is trusted to answer.
 *
 * `state.mode: "isolated"` (explicit, never a default) keeps the previous
 * behaviour: `<project>/<monolithRoot>/state.json`, one independent state per
 * worktree. A project that is not a git repository, or whose root is not the
 * root of its worktree, also stays local — and says so (`localReason`).
 *
 * This module is the only place that decides where state lives. The CLI, brief
 * and the read model all go through `resolveStateLocation`.
 *
 * It also reports, never repairs: worktree-local state files left next to a
 * shared state ("split-brain"). It never merges, picks a "winner" or deletes.
 *
 * Trust model: the git common directory is as trusted as the repository itself
 * (git follows it for every operation), so the shared directory is a
 * `trusted-directory` scope. The `monolith` directory itself is still refused
 * when it is a symlink.
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { lstatSync, realpathSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import { CONFIG_FILE_NAME, assertContainedFile, readBoundedFileStable, readConfigFile, resolveMonolithRoot, DEFAULT_MONOLITH_ROOT, } from '../root/index.js';
import { MONOLITH_VERSION } from '../version.js';
import { StateLocationError } from './errors.js';
import { MAX_STATE_BYTES, STATE_FILE_NAME, projectTarget, trustedDirectoryTarget, } from './state-keeper.js';
import { STATE_SCHEMA_VERSION } from './types.js';
/** Directory below the git common directory that holds MONOLITH's shared operational state. */
export const SHARED_STATE_DIR_NAME = 'monolith';
const GIT_TIMEOUT_MS = 10_000;
/** Variables that would make git answer for another repository than the directory we ask about. */
const GIT_ENV_STRIP = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_NAMESPACE'];
class GitError extends Error {
    failure;
    constructor(failure, detail) {
        super(detail);
        this.failure = failure;
    }
}
function git(cwd, args) {
    const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
    for (const k of GIT_ENV_STRIP)
        delete env[k];
    try {
        return execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=off', ...args], {
            cwd,
            encoding: 'utf8',
            timeout: GIT_TIMEOUT_MS,
            maxBuffer: 8 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
        });
    }
    catch (err) {
        if (err.code === 'ENOENT')
            throw new GitError('GIT_NOT_INSTALLED', 'git is not installed');
        const stderr = String(err.stderr ?? '');
        if (/not a git repository/i.test(stderr))
            throw new GitError('NOT_A_GIT_REPOSITORY', 'not a git repository');
        if (/this operation must be run in a work tree/i.test(stderr))
            throw new GitError('NOT_A_WORKTREE', 'not a work tree');
        throw new GitError('GIT_FAILED', stderr.trim().split('\n')[0] || (err instanceof Error ? err.message : String(err)));
    }
}
function readStateMode(config) {
    if (config.status !== 'ok')
        return 'shared';
    const raw = config.cfg.state;
    if (raw === undefined)
        return 'shared';
    const mode = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw.mode : undefined;
    if (mode === undefined)
        return 'shared';
    if (mode === 'shared' || mode === 'isolated')
        return mode;
    throw new StateLocationError(`${CONFIG_FILE_NAME}: state.mode must be "shared" or "isolated", got ${JSON.stringify(mode)}. ` +
        'Nothing was read or written; MONOLITH does not guess where the state lives.');
}
function localLocation(projectRoot, root, mode, reason, gitCommonDir) {
    return {
        projectRoot,
        mode,
        kind: 'project-local',
        localReason: reason,
        stateDir: root.rootAbs,
        statePath: join(root.rootAbs, STATE_FILE_NAME),
        displayPath: `${root.monolithRoot}/${STATE_FILE_NAME}`,
        gitCommonDir,
        root,
    };
}
/**
 * Decide where the operational state of `targetDir` lives. Throws
 * `RootContainmentError` (unusable root/config) or `StateLocationError`
 * (invalid `state.mode`, git cannot answer, unsafe shared directory) — it never
 * falls back to a local file when git merely fails, because that would recreate
 * the very split state this module exists to prevent.
 */
export function resolveStateLocation(targetDir, config = readConfigFile(targetDir)) {
    const projectRoot = resolve(targetDir);
    const root = resolveMonolithRoot(projectRoot, config);
    const mode = readStateMode(config);
    let commonDir;
    try {
        const topLevel = realpathSync(git(projectRoot, ['rev-parse', '--show-toplevel']).trim());
        const rawCommon = git(projectRoot, ['rev-parse', '--git-common-dir']).trim();
        commonDir = realpathSync(isAbsolute(rawCommon) ? rawCommon : resolve(projectRoot, rawCommon));
        if (mode === 'isolated')
            return localLocation(projectRoot, root, mode, 'ISOLATED_MODE', commonDir);
        if (topLevel !== root.projectRootReal) {
            // A project below the repository root (or an unrelated parent repository,
            // e.g. a dotfiles repo above $HOME) must not claim the repository's state.
            return localLocation(projectRoot, root, mode, 'PROJECT_NOT_AT_WORKTREE_ROOT', commonDir);
        }
    }
    catch (err) {
        if (!(err instanceof GitError))
            throw err;
        if (err.failure === 'NOT_A_GIT_REPOSITORY' || err.failure === 'NOT_A_WORKTREE') {
            return localLocation(projectRoot, root, mode, mode === 'isolated' ? 'ISOLATED_MODE' : 'NOT_A_GIT_REPOSITORY', null);
        }
        if (mode === 'isolated')
            return localLocation(projectRoot, root, mode, 'ISOLATED_MODE', null);
        throw new StateLocationError(`Cannot determine the shared state location: ${err.failure}: ${err.message}. ` +
            'Nothing was read or written. Fix git, or set "state": { "mode": "isolated" } in monolith.config.json to keep a per-worktree state.');
    }
    const stateDir = join(commonDir, SHARED_STATE_DIR_NAME);
    try {
        if (lstatSync(stateDir).isSymbolicLink()) {
            throw new StateLocationError(`"${stateDir}" is a symlink; the shared state directory must be a real directory. Nothing was read or written.`);
        }
    }
    catch (err) {
        if (err instanceof StateLocationError)
            throw err;
        if (err.code !== 'ENOENT') {
            throw new StateLocationError(`"${stateDir}" cannot be inspected: ${err.message}. Nothing was read or written.`);
        }
    }
    return {
        projectRoot,
        mode,
        kind: 'git-common-dir',
        localReason: null,
        stateDir,
        statePath: join(stateDir, STATE_FILE_NAME),
        displayPath: `<git-common-dir>/${SHARED_STATE_DIR_NAME}/${STATE_FILE_NAME}`,
        gitCommonDir: commonDir,
        root,
    };
}
/** Read target for `readState` & co. Local layout keeps the project-scope containment checks. */
export function stateReadTargetOf(loc) {
    if (loc.kind === 'git-common-dir')
        return trustedDirectoryTarget(loc.stateDir);
    assertContainedFile(loc.root, STATE_FILE_NAME);
    return projectTarget(loc.root.projectRoot, loc.root.rootAbs);
}
/** Write target for `mutateState` & co. */
export function stateWriteTargetOf(loc, onWarning) {
    if (loc.kind === 'git-common-dir')
        return trustedDirectoryTarget(loc.stateDir, onWarning);
    assertContainedFile(loc.root, STATE_FILE_NAME);
    assertContainedFile(loc.root, `${STATE_FILE_NAME}.lock`);
    return projectTarget(loc.root.projectRoot, loc.root.rootAbs, onWarning);
}
/**
 * True only when `dir` does not exist (ENOENT). The shared directory is created
 * by the first write, so before that a reader must see "no state yet", not a
 * boundary error. Anything else (a file in its place, EACCES) is not "absent".
 */
export function directoryAbsent(dir) {
    try {
        lstatSync(dir);
        return false;
    }
    catch (err) {
        return err.code === 'ENOENT';
    }
}
/**
 * The one bounded, non-blocking raw read of the state file, for read-only
 * consumers that report read failures as data (brief, read model). A shared
 * directory that does not exist yet reads as `FILE_MISSING`. `localBoundary` is
 * the project root a project-local file is read below.
 */
export function openStateFileBounded(loc, label, localBoundary) {
    const shared = loc.kind === 'git-common-dir';
    if (shared && directoryAbsent(loc.stateDir)) {
        return { ok: false, code: 'FILE_MISSING', detail: 'shared state directory does not exist yet' };
    }
    return readBoundedFileStable(loc.statePath, label, { boundary: shared ? loc.stateDir : localBoundary, maxBytes: MAX_STATE_BYTES, allowEmpty: true }, true);
}
function countKeys(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.keys(v).length : null;
}
/**
 * Read-only, bounded look at one state file. Accepts ANY schema version, only to
 * report what is there (revision, counts); it does not validate the content and
 * is never a way to load state. `boundary` is the directory the file lives in or
 * the project root that contains it.
 */
export function inspectStateFile(path, boundary) {
    const info = { path, status: 'unreadable', schemaVersion: null, revision: null, missionCount: null, checkpointCount: null };
    if (directoryAbsent(boundary))
        return { ...info, status: 'absent' };
    let read;
    try {
        read = readBoundedFileStable(path, `"${path}"`, { boundary, maxBytes: MAX_STATE_BYTES, allowEmpty: true }, true);
    }
    catch {
        return { ...info, readCode: 'FILE_UNREADABLE' };
    }
    if (!read.ok) {
        if (read.code === 'FILE_MISSING')
            return { ...info, status: 'absent' };
        return { ...info, readCode: read.code };
    }
    const raw = 'content' in read ? read.content : '';
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return { ...info, status: 'corrupt' };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return { ...info, status: 'corrupt' };
    const o = parsed;
    const tactical = typeof o.tactical === 'object' && o.tactical !== null ? o.tactical : {};
    return {
        ...info,
        status: o.schemaVersion === STATE_SCHEMA_VERSION ? 'ok' : 'incompatible-schema',
        schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : null,
        revision: typeof o.revision === 'number' && Number.isInteger(o.revision) ? o.revision : null,
        missionCount: countKeys(tactical.missions),
        checkpointCount: countKeys(tactical.checkpoints),
    };
}
/** true = holds Missions or Checkpoints; false = known to be empty; null = cannot tell (treated as "may hold data"). */
export function mayHoldUserData(info) {
    if (info.status === 'absent')
        return false;
    if (info.missionCount === null || info.checkpointCount === null)
        return true;
    return info.missionCount > 0 || info.checkpointCount > 0;
}
/** `git worktree list --porcelain`, minus bare entries and entries whose directory is gone. */
export function listWorktrees(projectRoot) {
    const out = git(projectRoot, ['worktree', 'list', '--porcelain']);
    const result = [];
    for (const block of out.split(/\n\n+/)) {
        let path = null;
        let branch = null;
        let bare = false;
        let prunable = false;
        for (const line of block.split('\n')) {
            if (line.startsWith('worktree '))
                path = line.slice('worktree '.length);
            else if (line.startsWith('branch '))
                branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
            else if (line === 'bare')
                bare = true;
            else if (line === 'prunable' || line.startsWith('prunable '))
                prunable = true;
        }
        if (path === null || bare || prunable)
            continue;
        try {
            if (!lstatSync(path).isDirectory())
                continue;
        }
        catch {
            continue;
        }
        result.push({ path, branch });
    }
    return result;
}
function worktreeLocalStatePath(worktree) {
    let rel = DEFAULT_MONOLITH_ROOT;
    try {
        // That worktree's own configuration decides where ITS legacy state would be.
        rel = resolveMonolithRoot(worktree).monolithRoot;
    }
    catch {
        /* unusable config there: the default location is the best known place */
    }
    return { path: join(worktree, rel, STATE_FILE_NAME), boundary: worktree };
}
/** Gather the facts about where the state lives and whether independent copies exist. Read-only. */
export function collectStateProvenance(loc) {
    const canonical = inspectStateFile(loc.statePath, loc.kind === 'git-common-dir' ? loc.stateDir : loc.projectRoot);
    let worktrees = [];
    let worktreeCount = null;
    if (loc.gitCommonDir !== null) {
        try {
            worktrees = listWorktrees(loc.projectRoot);
            worktreeCount = worktrees.length;
        }
        catch {
            /* worktree list unavailable: the count stays unknown, never guessed */
        }
    }
    const candidates = [];
    if (loc.kind === 'git-common-dir') {
        for (const wt of worktrees) {
            const { path, boundary } = worktreeLocalStatePath(wt.path);
            const info = inspectStateFile(path, boundary);
            if (info.status === 'absent')
                continue;
            candidates.push({
                ...info,
                worktree: wt.path,
                branch: wt.branch,
                current: safeRealpath(wt.path) === loc.root.projectRootReal,
                mayHoldUserData: mayHoldUserData(info),
            });
        }
    }
    // An empty scaffold (`monolith init` writes revision 0) is not a competing state.
    const competing = candidates.filter((c) => c.mayHoldUserData);
    return {
        monolithVersion: MONOLITH_VERSION,
        projectRoot: loc.projectRoot,
        repositoryIdentity: loc.gitCommonDir === null ? null : `repo-${createHash('sha256').update(loc.gitCommonDir).digest('hex').slice(0, 16)}`,
        gitCommonDir: loc.gitCommonDir,
        canonicalStatePath: loc.statePath,
        mode: loc.mode,
        kind: loc.kind,
        localReason: loc.localReason,
        canonical,
        worktreeCount,
        worktrees,
        splitBrain: {
            detected: competing.length > 0,
            canonicalMissingWithLocalData: canonical.status === 'absent' && competing.length > 0,
            candidates,
        },
    };
}
function safeRealpath(p) {
    try {
        return realpathSync(p);
    }
    catch {
        return resolve(p);
    }
}
/** Human-readable split-brain report (CLI). Lists every source; chooses and changes nothing. */
export function formatSplitBrain(p) {
    const sb = p.splitBrain;
    if (!sb.detected)
        return [];
    const lines = [];
    lines.push(sb.canonicalMissingWithLocalData
        ? 'WARNING: the shared state does not exist yet, but worktree-local state files with data do.'
        : 'WARNING: independent worktree-local state files exist next to the shared state (split-brain).');
    lines.push(`  canonical: ${p.canonicalStatePath} (${describeFile(p.canonical)})`);
    for (const c of sb.candidates) {
        lines.push(`  local:     ${c.path}${c.current ? '  [this worktree]' : ''} (${describeFile(c)})`);
    }
    lines.push('  Nothing was merged, chosen automatically or deleted; Consistency is NOT verified.');
    lines.push('  To make one of them the shared state: monolith state adopt <file>   (preview; add --apply to write).');
    return lines;
}
export function describeFile(f) {
    if (f.status === 'absent')
        return 'absent';
    const parts = [`status=${f.status}`];
    if (f.schemaVersion !== null)
        parts.push(`schema=${f.schemaVersion}`);
    if (f.revision !== null)
        parts.push(`revision=${f.revision}`);
    if (f.missionCount !== null)
        parts.push(`missions=${f.missionCount}`);
    if (f.checkpointCount !== null)
        parts.push(`checkpoints=${f.checkpointCount}`);
    if (f.readCode)
        parts.push(`read=${f.readCode}`);
    return parts.join(' ');
}
export function relativeDisplay(base, abs) {
    return relative(base, abs) || '.';
}
