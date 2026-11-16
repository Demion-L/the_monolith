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
import { type ConfigRead, type ResolvedMonolithRoot, type ProjectFileRead, type ProjectFileCheck } from '../root/index.js';
import { type StateReadTarget, type StateWriteTarget } from './state-keeper.js';
import type { WriteWarning } from '../root/index.js';
export type StateMode = 'shared' | 'isolated';
export type StateLocationKind = 'git-common-dir' | 'project-local';
export type LocalReason = 'ISOLATED_MODE' | 'NOT_A_GIT_REPOSITORY' | 'PROJECT_NOT_AT_WORKTREE_ROOT';
/** Directory below the git common directory that holds MONOLITH's shared operational state. */
export declare const SHARED_STATE_DIR_NAME = "monolith";
export interface StateLocation {
    /** Absolute project root (`resolve(targetDir)`). */
    projectRoot: string;
    /** The mode the project is configured for. */
    mode: StateMode;
    kind: StateLocationKind;
    /** Why the state is local although `shared` is the default; null when it is shared. */
    localReason: LocalReason | null;
    /** Absolute directory holding `state.json` and `state.json.lock`. */
    stateDir: string;
    /** Absolute canonical path of `state.json`. */
    statePath: string;
    /** Stable, non-absolute label for diagnostics shown to other tools. */
    displayPath: string;
    /** Real path of the git common directory; null when the project is not in a git worktree. */
    gitCommonDir: string | null;
    /** Instance root of the project (used for the local layout and for per-worktree legacy lookups). */
    root: ResolvedMonolithRoot;
}
export type GitFailure = 'GIT_NOT_INSTALLED' | 'NOT_A_GIT_REPOSITORY' | 'NOT_A_WORKTREE' | 'GIT_FAILED';
/**
 * Decide where the operational state of `targetDir` lives. Throws
 * `RootContainmentError` (unusable root/config) or `StateLocationError`
 * (invalid `state.mode`, git cannot answer, unsafe shared directory) — it never
 * falls back to a local file when git merely fails, because that would recreate
 * the very split state this module exists to prevent.
 */
export declare function resolveStateLocation(targetDir: string, config?: ConfigRead): StateLocation;
/** Read target for `readState` & co. Local layout keeps the project-scope containment checks. */
export declare function stateReadTargetOf(loc: StateLocation): StateReadTarget;
/** Write target for `mutateState` & co. */
export declare function stateWriteTargetOf(loc: StateLocation, onWarning?: (w: WriteWarning) => void): StateWriteTarget;
export type StateFileStatus = 'absent' | 'ok' | 'incompatible-schema' | 'corrupt' | 'unreadable';
export interface StateFileInfo {
    path: string;
    status: StateFileStatus;
    schemaVersion: number | null;
    revision: number | null;
    missionCount: number | null;
    checkpointCount: number | null;
    /** Read failure code (`FILE_SYMLINK`, ...) when `status` is `unreadable`. */
    readCode?: string;
}
/**
 * True only when `dir` does not exist (ENOENT). The shared directory is created
 * by the first write, so before that a reader must see "no state yet", not a
 * boundary error. Anything else (a file in its place, EACCES) is not "absent".
 */
export declare function directoryAbsent(dir: string): boolean;
/**
 * The one bounded, non-blocking raw read of the state file, for read-only
 * consumers that report read failures as data (brief, read model). A shared
 * directory that does not exist yet reads as `FILE_MISSING`. `localBoundary` is
 * the project root a project-local file is read below.
 */
export declare function openStateFileBounded(loc: StateLocation, label: string, localBoundary: string): ProjectFileRead | ProjectFileCheck;
/**
 * Read-only, bounded look at one state file. Accepts ANY schema version, only to
 * report what is there (revision, counts); it does not validate the content and
 * is never a way to load state. `boundary` is the directory the file lives in or
 * the project root that contains it.
 */
export declare function inspectStateFile(path: string, boundary: string): StateFileInfo;
/** true = holds Missions or Checkpoints; false = known to be empty; null = cannot tell (treated as "may hold data"). */
export declare function mayHoldUserData(info: StateFileInfo): boolean;
export interface WorktreeInfo {
    path: string;
    /** Null when the worktree has no branch (detached). */
    branch: string | null;
}
/** `git worktree list --porcelain`, minus bare entries and entries whose directory is gone. */
export declare function listWorktrees(projectRoot: string): WorktreeInfo[];
export interface LocalStateCandidate extends StateFileInfo {
    worktree: string;
    branch: string | null;
    /** True when this file belongs to the worktree the command runs in. */
    current: boolean;
    mayHoldUserData: boolean;
}
export interface SplitBrainReport {
    /** Worktree-local state files that exist next to a shared state (shared mode only). */
    detected: boolean;
    /** The shared state does not exist while worktree-local files that may hold user data do. */
    canonicalMissingWithLocalData: boolean;
    candidates: LocalStateCandidate[];
}
export interface StateProvenance {
    monolithVersion: string;
    projectRoot: string;
    /** Path-derived identity of the repository (same for all its worktrees); null outside git. */
    repositoryIdentity: string | null;
    gitCommonDir: string | null;
    canonicalStatePath: string;
    mode: StateMode;
    kind: StateLocationKind;
    localReason: LocalReason | null;
    /** The canonical file as found on disk. */
    canonical: StateFileInfo;
    worktreeCount: number | null;
    worktrees: WorktreeInfo[];
    splitBrain: SplitBrainReport;
}
/** Gather the facts about where the state lives and whether independent copies exist. Read-only. */
export declare function collectStateProvenance(loc: StateLocation): StateProvenance;
/** Human-readable split-brain report (CLI). Lists every source; chooses and changes nothing. */
export declare function formatSplitBrain(p: StateProvenance): string[];
export declare function describeFile(f: StateFileInfo): string;
export declare function relativeDisplay(base: string, abs: string): string;
//# sourceMappingURL=state-location.d.ts.map