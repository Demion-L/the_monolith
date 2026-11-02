/**
 * Bounded, safe project traversal (DISCOVERY-001B-1, ADR-021).
 *
 * Lists the directory tree of a project and nothing else: it never reads file
 * content, never writes, never runs project code and never touches the network.
 * It is the only code in Discovery that lists directories.
 *
 * What it does:
 *  - lists each directory through `opendir` + `Dir#readSync` (never `readdirSync`),
 *    one open handle at a time, so a hostile directory cannot be loaded whole before
 *    a cap applies; the handle is always closed (`finally`);
 *  - never follows a symlink (it is listed as kind `symlink` and counted; its target is
 *    never looked at); FIFOs, sockets and devices are listed as `other`, never opened;
 *  - excludes the real `<monolithRoot>` (resolved with `resolveMonolithRoot`, not by
 *    the literal name `.monolith`), a fixed list of dependency/build directories, nested
 *    repositories (a directory holding `.git`) and directories on another file system;
 *  - bounds the work and the retained result: directory entries READ (every listing counts,
 *    including the one of a directory later found to be unreadable, replaced or opaque),
 *    entries per directory, depth, wall-clock time and the UTF-8 bytes of the retained
 *    paths; every bound that fires yields `PARTIAL` with a typed diagnostic, never a
 *    silent cut. A nested repository is recognised by one `lstat` of `<dir>/.git` BEFORE
 *    the directory is listed, so its content is neither read nor counted;
 *  - is deterministic for an unchanged tree: names are ordered by UTF-16 code units
 *    (never `localeCompare`), breadth-first, and the result is sorted before it is
 *    returned. No clock value, absolute path or `readdir` order reaches the result.
 *
 * What it does NOT do (ADR-013, SEC-001B.3 open; TM-C unsupported): it does not prevent
 * and does not reliably detect a process that replaces a directory (e.g. with a symlink)
 * while the walk runs. The window runs from the `lstat` that queues a directory until
 * the walk has listed it, i.e. the breadth-first distance in between. Comparing the
 * identity (`dev`/`ino`) of a directory before and after listing it (`DIR_CHANGED`) may
 * notice SOME replacements; a replacement that is put back before the second `lstat`
 * goes unnoticed, and names read from the substitute can then appear as COMPLETE.
 * Do not run it on a tree an untrusted process is modifying.
 *
 * Root: `projectRoot` must be absolute and is the caller's explicit choice. A symlink as
 * root is accepted and its target is walked (nothing below the root is ever followed, so
 * the boundary is the directory the caller named). A missing, non-directory, unreadable
 * or otherwise unresolvable root throws `ROOT_UNSAFE` (from `resolveMonolithRoot`, before
 * any listing); `ROOT_NOT_DIRECTORY` is the defensive second check. Errors other than a
 * root-containment error from `resolveMonolithRoot` propagate unchanged.
 *
 * Nested MONOLITH instances: only the actual `<monolithRoot>` is excluded. A sub-project
 * that has its own `.monolith` stays part of the inventory (its sources belong to this
 * project); that directory is not recognised by name. Excluding the confirmed internals
 * of nested instances is a decision for DISCOVERY-001B-2.
 *
 * The time budget is checked between entries; a synchronous syscall that hangs in the
 * kernel (e.g. a dead network mount) is not interrupted.
 */
import { lstatSync, opendirSync, statSync, constants } from 'fs';
import { join } from 'path';
import { RootContainmentError, resolveMonolithRoot } from '../root/index.js';
/** Starting values (ADR-021 Q-10); validated by the 001B-1 benchmark, see the story report. */
export const DEFAULT_TRAVERSAL_LIMITS = Object.freeze({
    maxEntries: 50_000,
    maxEntriesPerDir: 10_000,
    maxDepth: 32,
    deadlineMs: 30_000,
    // Measured (DISCOVERY-001B-1-F): 50 000 paths of 3.6 KB each retained ~188 MiB of heap;
    // real trees average well under 100 B per path (a few MiB at 50 000 entries).
    maxPathBytes: 16 * 1024 * 1024,
});
/** Directories never entered, matched by name at any depth. */
export const EXCLUDED_DIR_NAMES = [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    'out',
    'coverage',
    '.venv',
    'venv',
    '__pycache__',
    'target',
    'vendor',
];
/** Directories never entered, matched by project-relative path. */
export const EXCLUDED_DIR_PATHS = ['.claude/worktrees'];
/** Per code: how many individual paths are listed before only the total is kept. */
const MAX_DIAGNOSTIC_PATHS = 20;
const MAX_NAME_BYTES = 255;
/**
 * Closed list. `affectsCompleteness` codes make the result PARTIAL (something inside
 * the declared scope could not be done). The others report the scope policy.
 * An unknown code is treated as affecting completeness (fail closed).
 */
const DIAGNOSTIC_AFFECTS_COMPLETENESS = {
    LIMIT_ENTRIES: true,
    LIMIT_DEPTH: true,
    LIMIT_DIR_ENTRIES: true,
    LIMIT_DEADLINE: true,
    LIMIT_PATH_BYTES: true,
    DIR_UNREADABLE: true,
    DIR_VANISHED: true,
    DIR_CHANGED: true,
    DIR_ERROR: true,
    NAME_UNREPRESENTABLE: true,
    ENTRY_UNCLASSIFIED: true,
    EXCLUDED_DIR: false,
    MONOLITH_ROOT_EXCLUDED: false,
    SYMLINK_SKIPPED: false,
    NESTED_REPO_SKIPPED: false,
    MOUNT_SKIPPED: false,
};
/**
 * Whether a code is a function of the tree and the parameters alone. A `false` code means a
 * second walk of the same path may return another result (clock speed, a tree being modified,
 * a transient I/O failure), so the result is not `reproducible`. Stable codes include the
 * resource limits that cut a deterministic prefix and permission errors on an unchanged tree.
 */
const DIAGNOSTIC_IS_STABLE = {
    LIMIT_ENTRIES: true,
    LIMIT_DEPTH: true,
    LIMIT_DIR_ENTRIES: true,
    LIMIT_DEADLINE: false,
    LIMIT_PATH_BYTES: true,
    DIR_UNREADABLE: true,
    DIR_VANISHED: false,
    DIR_CHANGED: false,
    DIR_ERROR: false,
    NAME_UNREPRESENTABLE: true,
    ENTRY_UNCLASSIFIED: false,
    EXCLUDED_DIR: true,
    MONOLITH_ROOT_EXCLUDED: true,
    SYMLINK_SKIPPED: true,
    NESTED_REPO_SKIPPED: true,
    MOUNT_SKIPPED: true,
};
/** The traversal cannot start or cannot be trusted; no result exists (FAILED). */
export class TraversalError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'TraversalError';
        this.code = code;
    }
}
const realFs = {
    opendir: (path) => opendirSync(path),
    lstat: (path) => lstatSync(path, { bigint: true }),
    stat: (path) => statSync(path, { bigint: true }),
};
// ---------------------------------------------------------------------------
function resolveLimits(partial) {
    const limits = { ...DEFAULT_TRAVERSAL_LIMITS, ...(partial ?? {}) };
    for (const key of Object.keys(DEFAULT_TRAVERSAL_LIMITS)) {
        const v = limits[key];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
            throw new TraversalError('INVALID_LIMITS', `limit "${key}" must be a positive integer (got ${String(v)}).`);
        }
    }
    return limits;
}
/**
 * Why a name cannot be represented faithfully, or `null`: U+FFFD (invalid UTF-8 was replaced),
 * NUL, C0/C1 controls, over-long, empty. The reason is a fixed phrase; the name itself never
 * reaches a diagnostic.
 */
function nameProblem(name) {
    if (name.length === 0)
        return 'empty';
    if (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES)
        return `longer than ${MAX_NAME_BYTES} bytes`;
    for (let i = 0; i < name.length; i++) {
        const c = name.charCodeAt(i);
        if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f))
            return 'contains a control character';
        if (c === 0xfffd)
            return 'contains U+FFFD (invalid UTF-8 or a literal replacement character)';
    }
    return null;
}
/** UTF-16 code-unit order (the default `<`), not locale order. */
function compareUnits(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
class DiagnosticLog {
    byCode = new Map();
    add(code, message, path) {
        let slot = this.byCode.get(code);
        if (!slot) {
            slot = { total: 0, items: [] };
            this.byCode.set(code, slot);
        }
        slot.total++;
        if (slot.items.length < MAX_DIAGNOSTIC_PATHS) {
            slot.items.push(path === undefined ? { code, message } : { code, path, message });
        }
    }
    has(code) {
        return this.byCode.has(code);
    }
    isStable() {
        for (const code of this.byCode.keys()) {
            if (!DIAGNOSTIC_IS_STABLE[code])
                return false;
        }
        return true;
    }
    affectsCompleteness() {
        for (const code of this.byCode.keys()) {
            if (DIAGNOSTIC_AFFECTS_COMPLETENESS[code] !== false)
                return true;
        }
        return false;
    }
    toSortedList() {
        const out = [];
        for (const [code, slot] of this.byCode) {
            out.push(...slot.items);
            if (slot.total > slot.items.length) {
                out.push({ code, count: slot.total, message: `${slot.total} occurrences in total; the first ${slot.items.length} are listed.` });
            }
        }
        const rank = (d) => (DIAGNOSTIC_AFFECTS_COMPLETENESS[d.code] !== false ? 0 : 1);
        return out.sort((a, b) => rank(a) - rank(b) ||
            compareUnits(a.code, b.code) ||
            compareUnits(a.path ?? '', b.path ?? '') ||
            compareUnits(a.message, b.message));
    }
}
/**
 * The only way a file-system error reaches a diagnostic or a thrown message: its `code`, and
 * only when it looks like an errno name. `message`, `stack` and any other property of an
 * error are untrusted (a seam or exotic file system can put a path or control characters in
 * them) and are never copied.
 */
const SAFE_ERRNO = /^[A-Z][A-Z0-9_]{1,31}$/;
const UNKNOWN_ERROR = 'UNKNOWN_ERROR';
function errno(err) {
    let code;
    try {
        code = err?.code;
    }
    catch {
        return UNKNOWN_ERROR;
    }
    return typeof code === 'string' && SAFE_ERRNO.test(code) ? code : UNKNOWN_ERROR;
}
/**
 * List one directory with two hard caps and always close the handle. Reading stops at the
 * first entry beyond `maxEntriesPerDir` ('opaque') or beyond `budgetLeft` ('budget'; the
 * directory does not fit in what `maxEntries` leaves). Both outcomes depend only on how many
 * entries the directory has, never on the order they are returned in. When the caps coincide
 * the directory is reported as opaque.
 */
function listDirectory(fs, abs, maxEntriesPerDir, budgetLeft) {
    let handle;
    try {
        handle = fs.opendir(abs);
    }
    catch (err) {
        return failureOf(err, 0);
    }
    const dirents = [];
    const cap = Math.min(maxEntriesPerDir, budgetLeft);
    let outcome;
    try {
        for (;;) {
            const dirent = handle.readSync();
            if (dirent === null)
                break;
            if (dirents.length >= cap) {
                // One entry more than the cap: stop reading, the directory is not enumerated.
                const opaque = maxEntriesPerDir <= budgetLeft;
                return opaque
                    ? { ok: false, read: dirents.length + 1, reason: 'opaque', detail: `more than ${maxEntriesPerDir} entries` }
                    : { ok: false, read: dirents.length + 1, reason: 'budget', detail: `more than ${budgetLeft} entries left in the budget` };
            }
            dirents.push({ name: dirent.name, dirent });
        }
        outcome = { ok: true, read: dirents.length, dirents };
    }
    catch (err) {
        outcome = failureOf(err, dirents.length);
    }
    finally {
        try {
            handle.closeSync();
        }
        catch {
            // A failed close of a read-only handle changes nothing we returned.
        }
    }
    return outcome;
}
function failureOf(err, read) {
    const code = errno(err);
    if (code === 'EACCES' || code === 'EPERM')
        return { ok: false, read, reason: 'unreadable', detail: `${code}` };
    if (code === 'ENOENT' || code === 'ENOTDIR')
        return { ok: false, read, reason: 'vanished', detail: `${code}` };
    return { ok: false, read, reason: 'error', detail: code };
}
/** Whether `<abs>/.git` exists (any type, not followed). One `lstat`, no listing; any failure means "not known to exist". */
function hasGitEntry(fs, abs) {
    try {
        fs.lstat(join(abs, '.git'));
        return true;
    }
    catch {
        return false;
    }
}
/** Throws when the type is not reported and `lstat` fails: the caller must not invent a kind. */
function direntKind(fs, dirent, abs) {
    if (dirent.isSymbolicLink())
        return 'symlink';
    if (dirent.isDirectory())
        return 'directory';
    if (dirent.isFile())
        return 'file';
    // DT_UNKNOWN: the file system does not report a type in the listing; ask, without following.
    const st = fs.lstat(abs);
    if (st.isSymbolicLink())
        return 'symlink';
    if (st.isDirectory())
        return 'directory';
    if (st.isFile())
        return 'file';
    return 'other';
}
/**
 * Walk the project at `projectRoot` and return its structure.
 *
 * `projectRoot` is the explicit, caller-resolved project directory (for the CLI: `cwd`).
 * The instance root is resolved with `resolveMonolithRoot` and excluded. Throws
 * `TraversalError` when the walk cannot start or be trusted; otherwise returns a
 * result that says whether it is `COMPLETE` or `PARTIAL`.
 */
export function traverseProject(projectRoot, options = {}) {
    const flags = options.platformFlags ?? { noFollow: constants.O_NOFOLLOW, nonBlock: constants.O_NONBLOCK };
    if (typeof flags.noFollow !== 'number' || flags.noFollow === 0 || typeof flags.nonBlock !== 'number' || flags.nonBlock === 0) {
        throw new TraversalError('UNSUPPORTED_PLATFORM', 'this platform lacks O_NOFOLLOW/O_NONBLOCK; Discovery fails closed here (ADR-021).');
    }
    const limits = resolveLimits(options.limits);
    const fs = options.fs ?? realFs;
    const now = options.now ?? (() => Number(process.hrtime.bigint() / 1000000n));
    let monolithRoot;
    try {
        monolithRoot = resolveMonolithRoot(projectRoot).monolithRoot;
    }
    catch (err) {
        if (err instanceof RootContainmentError)
            throw new TraversalError('ROOT_UNSAFE', err.message, { cause: err });
        throw err;
    }
    let rootIdentity;
    try {
        rootIdentity = fs.stat(projectRoot);
    }
    catch (err) {
        throw new TraversalError('ROOT_NOT_DIRECTORY', `project root is not accessible (${errno(err)}).`);
    }
    if (!rootIdentity.isDirectory())
        throw new TraversalError('ROOT_NOT_DIRECTORY', 'project root is not a directory.');
    const startedAt = now();
    const diagnostics = new DiagnosticLog();
    const entries = [];
    const stats = { entries: 0, files: 0, directories: 0, symlinks: 0, other: 0, examined: 0, pathBytes: 0, listedDirectories: 0 };
    let stopped = false;
    let deadlineFired = false;
    const overDeadline = () => {
        if (now() - startedAt > limits.deadlineMs) {
            if (!deadlineFired)
                diagnostics.add('LIMIT_DEADLINE', `time budget of ${limits.deadlineMs} ms exhausted; the walk stopped.`);
            deadlineFired = true;
            stopped = true;
        }
        return stopped;
    };
    const queue = [{ rel: '', depth: 0, identity: rootIdentity }];
    for (let qi = 0; qi < queue.length && !overDeadline(); qi++) {
        const dir = queue[qi];
        const abs = dir.rel === '' ? projectRoot : join(projectRoot, dir.rel);
        const label = dir.rel === '' ? '.' : dir.rel;
        // A nested repository is recognised without listing it, so its content is neither read nor counted.
        if (dir.rel !== '' && hasGitEntry(fs, abs)) {
            diagnostics.add('NESTED_REPO_SKIPPED', 'nested repository or worktree (contains .git); not entered.', label);
            continue;
        }
        const listed = listDirectory(fs, abs, limits.maxEntriesPerDir, limits.maxEntries - stats.examined);
        // Every listing is charged for what it read, whatever becomes of it (kept, unreadable, replaced, opaque).
        stats.examined += listed.read;
        if (stats.examined > limits.maxEntries) {
            diagnostics.add('LIMIT_ENTRIES', `more than ${limits.maxEntries} entries read; the walk stopped.`);
            stopped = true;
        }
        if (!listed.ok) {
            if (listed.reason === 'opaque') {
                diagnostics.add('LIMIT_DIR_ENTRIES', `directory has more than ${limits.maxEntriesPerDir} entries; not enumerated.`, label);
            }
            else if (listed.reason === 'budget') {
                // LIMIT_ENTRIES was recorded above: this directory did not fit in the remaining budget.
            }
            else if (listed.reason === 'unreadable') {
                diagnostics.add('DIR_UNREADABLE', `directory cannot be read (${listed.detail}).`, label);
            }
            else if (listed.reason === 'vanished') {
                diagnostics.add('DIR_VANISHED', `directory disappeared during the walk (${listed.detail}); the tree is being modified.`, label);
            }
            else {
                diagnostics.add('DIR_ERROR', `directory cannot be listed (${listed.detail}).`, label);
            }
            continue;
        }
        // Identity after listing must match the identity before (may notice a replacement; does not prevent one; see header).
        let after;
        try {
            after = dir.rel === '' ? fs.stat(abs) : fs.lstat(abs);
        }
        catch (err) {
            diagnostics.add('DIR_VANISHED', `directory disappeared during the walk (${errno(err)}); the tree is being modified.`, label);
            continue;
        }
        if (after.dev !== dir.identity.dev || after.ino !== dir.identity.ino || (dir.rel !== '' && !after.isDirectory())) {
            diagnostics.add('DIR_CHANGED', 'directory was replaced while it was being listed; its contents are discarded.', label);
            continue;
        }
        stats.listedDirectories++;
        // The probe above normally catches this; the listing is the second look (a .git that appeared meanwhile).
        const hasGit = listed.dirents.some((d) => d.name === '.git');
        if (dir.rel !== '' && hasGit) {
            diagnostics.add('NESTED_REPO_SKIPPED', 'nested repository or worktree (contains .git); not entered.', label);
            continue;
        }
        const sorted = listed.dirents.sort((a, b) => compareUnits(a.name, b.name));
        for (const { name, dirent } of sorted) {
            if (overDeadline())
                break;
            const rel = dir.rel === '' ? name : `${dir.rel}/${name}`;
            const problem = nameProblem(name);
            if (problem !== null) {
                diagnostics.add('NAME_UNREPRESENTABLE', `an entry whose name ${problem} was excluded; its name is not shown.`, label);
                continue;
            }
            if (rel === monolithRoot) {
                diagnostics.add('MONOLITH_ROOT_EXCLUDED', 'the MONOLITH instance root is not part of the inventory.', rel);
                continue;
            }
            let kind;
            try {
                kind = direntKind(fs, dirent, join(projectRoot, rel));
            }
            catch (err) {
                // No type was reported and lstat failed: do not state a type, and do not hide the cause.
                diagnostics.add('ENTRY_UNCLASSIFIED', `entry type could not be determined (${errno(err)}); not listed.`, rel);
                continue;
            }
            if (kind === 'directory' && (EXCLUDED_DIR_NAMES.includes(name) || EXCLUDED_DIR_PATHS.includes(rel))) {
                diagnostics.add('EXCLUDED_DIR', `excluded directory "${name}".`, rel);
                continue;
            }
            const bytes = Buffer.byteLength(rel, 'utf8');
            if (stats.pathBytes + bytes > limits.maxPathBytes) {
                diagnostics.add('LIMIT_PATH_BYTES', `retained paths would exceed ${limits.maxPathBytes} bytes; the walk stopped.`);
                stopped = true;
                break;
            }
            stats.pathBytes += bytes;
            entries.push({ path: rel, kind });
            stats.entries++;
            if (kind === 'file')
                stats.files++;
            else if (kind === 'directory')
                stats.directories++;
            else if (kind === 'symlink') {
                stats.symlinks++;
                diagnostics.add('SYMLINK_SKIPPED', 'symbolic link listed, not followed.', rel);
            }
            else
                stats.other++;
            if (kind !== 'directory')
                continue;
            const depth = dir.depth + 1;
            if (depth >= limits.maxDepth) {
                diagnostics.add('LIMIT_DEPTH', `directory is at the maximum depth of ${limits.maxDepth}; not entered.`, rel);
                continue;
            }
            let identity;
            try {
                identity = fs.lstat(join(projectRoot, rel));
            }
            catch (err) {
                diagnostics.add('DIR_VANISHED', `directory disappeared during the walk (${errno(err)}); the tree is being modified.`, rel);
                continue;
            }
            if (!identity.isDirectory()) {
                diagnostics.add('DIR_CHANGED', 'entry listed as a directory is no longer one; not entered.', rel);
                continue;
            }
            if (identity.dev !== rootIdentity.dev) {
                diagnostics.add('MOUNT_SKIPPED', 'directory is on another file system; not entered.', rel);
                continue;
            }
            queue.push({ rel, depth, identity });
        }
    }
    entries.sort((a, b) => compareUnits(a.path, b.path));
    return {
        completeness: diagnostics.affectsCompleteness() ? 'PARTIAL' : 'COMPLETE',
        reproducible: diagnostics.isStable(),
        limits,
        stats,
        entries,
        diagnostics: diagnostics.toSortedList(),
    };
}
