/**
 * Single source of truth for where a MONOLITH instance lives (SEC-001A).
 *
 * Policy (ADR-009):
 *  - `monolithRoot` is a RELATIVE path strictly INSIDE the project root.
 *  - Absent config file, or absent `monolithRoot` key → documented default
 *    `.monolith`. A config file that EXISTS but cannot be used (unreadable,
 *    invalid JSON, not an object) or a `monolithRoot` that is present but not
 *    a non-empty string → configuration error (never silently defaulted).
 *  - Absolute paths, any `..` segment, and a root that normalizes to the
 *    project root itself are rejected. (`..` is rejected even when it would
 *    lexically stay inside: the kernel resolves `a/..` through `a`, so a
 *    symlinked `a` makes lexical and real resolution diverge.)
 *  - Every existing component of the path must resolve (realpath) inside
 *    the real project root; dangling symlinks and symlink loops fail closed.
 *  - Violations throw RootContainmentError — callers never fall back.
 *
 * This module only reads (lstat/realpath/open+read). It never creates
 * anything. Check-then-use (TOCTOU) races are NOT closed here; see ADR-009,
 * ADR-011 and ADR-013 (the unified safe read contract implemented below).
 *
 * It also hosts the bounded project-file helpers (`checkProjectFile`,
 * `readProjectFile`, SEC-002) used for root-level files such as
 * `project.definition.mjs`, `monolith.config.json` and `AGENTS.md`, which
 * live next to — not below — `monolithRoot`.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'fs';
import { isAbsolute, join, relative, resolve, sep, win32 } from 'path';
export const DEFAULT_MONOLITH_ROOT = '.monolith';
export const CONFIG_FILE_NAME = 'monolith.config.json';
export class RootContainmentError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.name = 'RootContainmentError';
        this.code = code;
    }
}
function errMsg(err) {
    return err instanceof Error ? err.message : String(err);
}
/** Read `monolith.config.json` without interpreting `monolithRoot`. */
export function readConfigFile(targetDir) {
    // Bounded, containment-checked read (SEC-002): a FIFO/device/oversized config
    // or a symlink leaving the project is "unreadable" (fail closed), never
    // blocking and never read past MAX_PROJECT_FILE_BYTES. An absent file, and
    // only an absent file, is "absent".
    const read = readProjectFile(targetDir, CONFIG_FILE_NAME, { allowEmpty: true });
    if (!read.ok) {
        if (read.code === 'FILE_MISSING')
            return { status: 'absent' };
        return { status: 'unreadable', detail: `${read.code}: ${read.detail}` };
    }
    let parsed;
    try {
        parsed = JSON.parse(read.content);
    }
    catch (err) {
        return { status: 'invalid-json', detail: errMsg(err) };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { status: 'not-object', detail: 'does not contain a JSON object' };
    }
    return { status: 'ok', cfg: parsed };
}
/**
 * Lexical validation. Returns the normalized root: `/`-joined segments with
 * empty and `.` segments removed. Throws RootContainmentError otherwise.
 */
export function normalizeMonolithRoot(value) {
    if (typeof value !== 'string') {
        throw new RootContainmentError('ROOT_INVALID_TYPE', `monolithRoot must be a string, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}.`);
    }
    if (value.length === 0) {
        throw new RootContainmentError('ROOT_EMPTY', 'monolithRoot must not be an empty string.');
    }
    if (value.includes('\0')) {
        throw new RootContainmentError('ROOT_INVALID_TYPE', 'monolithRoot must not contain NUL bytes.');
    }
    // Both flavors are rejected on every platform: a config must mean the same thing everywhere.
    if (isAbsolute(value) || win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
        throw new RootContainmentError('ROOT_ABSOLUTE', `monolithRoot must be relative to the project root, got "${value}".`);
    }
    const segments = value.split(/[\\/]+/).filter((s) => s !== '' && s !== '.');
    if (segments.includes('..')) {
        throw new RootContainmentError('ROOT_TRAVERSAL', `monolithRoot must not contain ".." segments, got "${value}".`);
    }
    if (segments.length === 0) {
        throw new RootContainmentError('ROOT_IS_PROJECT_ROOT', `monolithRoot "${value}" resolves to the project root itself; use a subdirectory such as "${DEFAULT_MONOLITH_ROOT}".`);
    }
    return segments.join('/');
}
/** Path-component-aware containment (never a string prefix test). */
function isInside(baseAbs, candidateAbs) {
    const rel = relative(baseAbs, candidateAbs);
    return rel === '' || (rel.split(/[\\/]/)[0] !== '..' && !isAbsolute(rel));
}
function realProjectRoot(projectRoot) {
    try {
        return realpathSync(projectRoot);
    }
    catch (err) {
        throw new RootContainmentError('ROOT_UNRESOLVABLE', `project root "${projectRoot}" cannot be resolved: ${errMsg(err)}`);
    }
}
/**
 * Walk `segments` below the real project root. Each component that exists
 * is realpath'd and must stay inside; the first missing component ends the
 * walk (the nearest existing ancestor has already been verified). A symlink
 * whose target is missing, or a loop, is refused.
 */
function assertSegmentsContained(projectRootReal, segments, label) {
    let current = projectRootReal;
    for (const seg of segments) {
        const next = join(current, seg);
        let isLink;
        try {
            isLink = lstatSync(next).isSymbolicLink();
        }
        catch (err) {
            if (err.code === 'ENOENT')
                return;
            throw new RootContainmentError('ROOT_UNRESOLVABLE', `"${label}" cannot be inspected at "${seg}": ${errMsg(err)}`);
        }
        let real;
        try {
            real = realpathSync(next);
        }
        catch (err) {
            const why = err.code === 'ENOENT' ? 'dangling symlink' : errMsg(err);
            throw new RootContainmentError('ROOT_UNRESOLVABLE', `"${label}" cannot be resolved at "${seg}" (${why}).`);
        }
        if (!isInside(projectRootReal, real)) {
            throw new RootContainmentError('ROOT_SYMLINK_ESCAPE', `"${label}" leaves the project root at "${seg}"${isLink ? ' (symlink)' : ''}.`);
        }
        current = real;
    }
}
/** Validate a root value against a project directory (no config read). */
export function resolveMonolithRootValue(targetDir, value) {
    const monolithRoot = normalizeMonolithRoot(value);
    const projectRoot = resolve(targetDir);
    const projectRootReal = realProjectRoot(projectRoot);
    assertSegmentsContained(projectRootReal, monolithRoot.split('/'), monolithRoot);
    return {
        projectRoot,
        projectRootReal,
        monolithRoot,
        rootAbs: join(projectRoot, monolithRoot),
        source: 'default',
    };
}
/**
 * Resolve the instance root for `targetDir`. Pass an already-read config
 * (`readConfigFile`) to avoid reading twice. Only an ABSENT config file yields
 * the default root; an existing but unusable one throws ROOT_CONFIG_INVALID
 * (fail closed) so a broken config can never redirect writes to `.monolith`.
 */
export function resolveMonolithRoot(targetDir, config = readConfigFile(targetDir)) {
    if (config.status !== 'absent' && config.status !== 'ok') {
        throw new RootContainmentError('ROOT_CONFIG_INVALID', `${CONFIG_FILE_NAME} exists but is unusable (${config.status}: ${config.detail}); refusing to fall back to "${DEFAULT_MONOLITH_ROOT}".`);
    }
    if (config.status === 'ok' && Object.prototype.hasOwnProperty.call(config.cfg, 'monolithRoot')) {
        return { ...resolveMonolithRootValue(targetDir, config.cfg.monolithRoot), source: 'config' };
    }
    return resolveMonolithRootValue(targetDir, DEFAULT_MONOLITH_ROOT);
}
/**
 * Verify a fixed file below the instance root (state.json, active.md,
 * state.json.lock, ...) against the real project root, so a symlinked file
 * or a symlinked intermediate directory cannot redirect I/O outside.
 * Returns the lexical absolute path. `relFromRoot` must be trusted/fixed.
 */
export function assertContainedFile(root, relFromRoot) {
    const segments = [...root.monolithRoot.split('/'), ...relFromRoot.split('/')];
    assertSegmentsContained(root.projectRootReal, segments, `${root.monolithRoot}/${relFromRoot}`);
    return join(root.rootAbs, relFromRoot);
}
/** Non-throwing variant for read paths that report diagnostics. */
export function checkContainedFile(root, relFromRoot) {
    try {
        assertContainedFile(root, relFromRoot);
        return null;
    }
    catch (err) {
        if (err instanceof RootContainmentError)
            return err;
        throw err;
    }
}
// ---------------------------------------------------------------------------
// Unified safe read contract (SEC-002, ADR-011; SEC-001B.1-R, ADR-013)
// ---------------------------------------------------------------------------
/** Upper bound for any file this module inspects or reads (1 MiB). */
export const MAX_PROJECT_FILE_BYTES = 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
/**
 * Codes that mean "the file system layout is not what a MONOLITH-managed file
 * must look like" — as opposed to missing, empty, oversized or a transient
 * replacement. A caller may want to surface these differently from an I/O fault.
 */
export const READ_SECURITY_CODES = [
    'FILE_OUTSIDE_PROJECT',
    'FILE_SYMLINK',
    'FILE_HARDLINKED',
    'FILE_NOT_REGULAR',
    'READ_BOUNDARY_INVALID',
    'READ_UNSUPPORTED_PLATFORM',
];
export function isReadSecurityViolation(code) {
    return READ_SECURITY_CODES.includes(code);
}
function fail(code, detail) {
    return { ok: false, code, detail };
}
function errCode(err) {
    return err?.code;
}
/** Segments of `abs` below `base`, or `null` when it is not strictly inside. */
function segmentsBelow(base, abs) {
    const rel = relative(base, abs);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
        return null;
    return rel.split(sep).filter((s) => s.length > 0);
}
/**
 * The unified safe read (SEC-001B.1-R). One policy for every MONOLITH-managed
 * file; there is no permissive variant. Order matters:
 *  1. platform capabilities (`O_NOFOLLOW`, `O_NONBLOCK`) — absent → fail closed;
 *  2. explicit boundary: `abs` and `boundary` must be absolute (never the cwd),
 *     the boundary must be a directory, `abs` must lie strictly below it;
 *  3. `lstat` of EVERY component below the boundary: none may be a symlink
 *     (inside the project or not, dangling or not); the last must be a regular
 *     file with a single link — decided BEFORE `open`, so a FIFO/device/socket
 *     is never opened;
 *  4. `open` with `O_NOFOLLOW|O_NONBLOCK|O_NOCTTY`;
 *  5. `fstat` on the descriptor: still a regular file, same `dev/ino` as step 3,
 *     still one link, size within bounds — all before any content is read;
 *  6. optional read of at most `maxBytes + 1` bytes (the cap applies to bytes
 *     actually read); the descriptor is always closed.
 * Steps 3 and 4 are separate syscalls: this does NOT defend against a local
 * actor swapping a directory or file between them (dynamic TOCTOU, SEC-001B.3).
 * The identity check detects a swap of the FILE only. `label` is for diagnostics.
 * A file replaced between `lstat` and `open` is FILE_CHANGED (transient,
 * retryable), not a fault.
 */
export function readBoundedFile(abs, label, opts, wantContent) {
    const noFollow = opts.platformFlags ? opts.platformFlags.noFollow : constants.O_NOFOLLOW;
    const nonBlock = opts.platformFlags ? opts.platformFlags.nonBlock : constants.O_NONBLOCK;
    if (typeof noFollow !== 'number' || noFollow === 0 || typeof nonBlock !== 'number' || nonBlock === 0) {
        return fail('READ_UNSUPPORTED_PLATFORM', `${label}: this platform lacks O_NOFOLLOW/O_NONBLOCK, so a managed file cannot be read safely; refusing.`);
    }
    const boundary = opts.boundary;
    if (typeof boundary !== 'string' || boundary.length === 0 || !isAbsolute(boundary)) {
        return fail('READ_BOUNDARY_INVALID', `${label}: a read requires an explicit absolute boundary directory (never the cwd).`);
    }
    if (typeof abs !== 'string' || abs.length === 0 || !isAbsolute(abs)) {
        return fail('READ_BOUNDARY_INVALID', `${label}: the path must be absolute (never resolved against the cwd).`);
    }
    const boundaryLexical = resolve(boundary);
    let boundaryReal;
    try {
        boundaryReal = realpathSync(boundaryLexical);
        if (!statSync(boundaryReal).isDirectory())
            throw new Error('not a directory');
    }
    catch (err) {
        return fail('READ_BOUNDARY_INVALID', `${label}: boundary "${boundaryLexical}" is not a usable directory: ${errMsg(err)}`);
    }
    const target = resolve(abs);
    let base = boundaryLexical;
    let segs = segmentsBelow(boundaryLexical, target);
    if (segs === null) {
        base = boundaryReal;
        segs = segmentsBelow(boundaryReal, target);
    }
    if (segs === null) {
        return fail('FILE_OUTSIDE_PROJECT', `${label} is not strictly inside the read boundary "${boundaryLexical}".`);
    }
    let before;
    let current = base;
    for (let i = 0; i < segs.length; i++) {
        current = join(current, segs[i]);
        const last = i === segs.length - 1;
        let st;
        try {
            st = lstatSync(current, { bigint: true });
        }
        catch (err) {
            if (errCode(err) === 'ENOENT')
                return fail('FILE_MISSING', `${label} does not exist.`);
            return fail('FILE_UNRESOLVABLE', `${label} cannot be inspected at "${segs[i]}": ${errMsg(err)}`);
        }
        if (st.isSymbolicLink()) {
            return fail('FILE_SYMLINK', `${label} passes through a symbolic link at "${segs[i]}"; managed files must not.`);
        }
        if (!last) {
            if (!st.isDirectory())
                return fail('FILE_UNRESOLVABLE', `${label} cannot be resolved: "${segs[i]}" is not a directory.`);
            continue;
        }
        if (!st.isFile())
            return fail('FILE_NOT_REGULAR', `${label} is not a regular file.`);
        if (st.nlink > 1n)
            return fail('FILE_HARDLINKED', `${label} has ${st.nlink} hard links; managed files must have exactly one.`);
        before = st;
    }
    if (before === undefined)
        return fail('READ_BOUNDARY_INVALID', `${label} is the boundary itself, not a file below it.`);
    const maxBytes = opts.maxBytes ?? MAX_PROJECT_FILE_BYTES;
    opts.afterInspect?.();
    let fd;
    try {
        fd = openSync(current, constants.O_RDONLY | noFollow | nonBlock | constants.O_NOCTTY);
    }
    catch (err) {
        if (errCode(err) === 'ENOENT')
            return fail('FILE_MISSING', `${label} does not exist.`);
        // O_NOFOLLOW on a symlink: the path became a link after the lstat.
        if (errCode(err) === 'ELOOP')
            return fail('FILE_SYMLINK', `${label} became a symbolic link while being opened.`);
        return fail('FILE_UNREADABLE', `${label} cannot be opened: ${errMsg(err)}`);
    }
    try {
        const st = fstatSync(fd, { bigint: true });
        if (!st.isFile())
            return fail('FILE_NOT_REGULAR', `${label} is not a regular file.`);
        if (st.dev !== before.dev || st.ino !== before.ino) {
            return fail('FILE_CHANGED', `${label} changed while it was being inspected.`);
        }
        if (st.nlink > 1n)
            return fail('FILE_HARDLINKED', `${label} has ${st.nlink} hard links; managed files must have exactly one.`);
        if (st.size === 0n && !opts.allowEmpty)
            return fail('FILE_EMPTY', `${label} is empty.`);
        if (st.size > BigInt(maxBytes))
            return fail('FILE_TOO_LARGE', `${label} is ${st.size} bytes; the limit is ${maxBytes}.`);
        if (!wantContent)
            return { ok: true, path: abs, size: Number(st.size) };
        const chunks = [];
        let total = 0;
        for (;;) {
            const buf = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes + 1 - total));
            const n = readSync(fd, buf, 0, buf.length, null);
            if (n === 0)
                break;
            total += n;
            if (total > maxBytes)
                return fail('FILE_TOO_LARGE', `${label} grew beyond the limit of ${maxBytes} bytes while being read.`);
            chunks.push(buf.subarray(0, n));
        }
        return { ok: true, path: abs, size: total, content: Buffer.concat(chunks).toString('utf8') };
    }
    catch (err) {
        return fail('FILE_UNREADABLE', `${label} cannot be read: ${errMsg(err)}`);
    }
    finally {
        closeSync(fd);
    }
}
const CHANGED_RETRIES = 3;
const LINKED_RETRIES = 5;
const LINKED_RETRY_DELAY_MS = 2;
function sleepMs(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
/**
 * `readBoundedFile`, retried across the two states MONOLITH's own writers pass
 * through (neither is a fault): the file is atomically replaced under us
 * (FILE_CHANGED, `rename`), or it has a second link for an instant
 * (FILE_HARDLINKED: a lock is published by `link()`ing its staging file and
 * the staging name is removed right after, SEC-001B.2). After the retries the
 * result is reported as it is — a link that stays is refused, never accepted.
 * Same policy, same options.
 */
export function readBoundedFileStable(abs, label, opts, wantContent) {
    let r = readBoundedFile(abs, label, opts, wantContent);
    let changed = 1;
    let linked = 1;
    while (!r.ok) {
        if (r.code === 'FILE_CHANGED' && changed < CHANGED_RETRIES) {
            changed++;
        }
        else if (r.code === 'FILE_HARDLINKED' && linked < LINKED_RETRIES) {
            linked++;
            sleepMs(LINKED_RETRY_DELAY_MS);
        }
        else {
            break;
        }
        r = readBoundedFile(abs, label, opts, wantContent);
    }
    return r;
}
/** `projectRoot` is the explicit boundary; `relPath` is `/`-separated and must be trusted/fixed. */
function openProjectFile(projectRoot, relPath, opts, wantContent) {
    if (typeof projectRoot !== 'string' || projectRoot.length === 0 || !isAbsolute(projectRoot)) {
        return fail('READ_BOUNDARY_INVALID', `${relPath}: the project root must be an explicit absolute path (never the cwd).`);
    }
    return readBoundedFile(join(projectRoot, relPath), relPath, { ...opts, boundary: projectRoot }, wantContent);
}
/**
 * Static check of a file below the PROJECT root (not `monolithRoot`) under the
 * unified read policy: exists, no symlink in any component below the root,
 * regular file with one link, non-empty (unless `allowEmpty`) and within
 * `maxBytes`. The content is never read.
 */
export function checkProjectFile(projectRoot, relPath, opts = {}) {
    return openProjectFile(projectRoot, relPath, opts, false);
}
/** `checkProjectFile` plus a bounded UTF-8 read of the content. */
export function readProjectFile(projectRoot, relPath, opts = {}) {
    return openProjectFile(projectRoot, relPath, opts, true);
}
// ---------------------------------------------------------------------------
// Safe writes (SEC-001B.2, ADR-012)
// ---------------------------------------------------------------------------
export { SafeWriteError, WriteBoundary, ParentRef, projectBoundary, trustedDirectoryBoundary, openParent, boundaryPathOf, probeTarget, createExclusive, disposeOwned, publishLink, createFile, replaceFile, detectPlatformCaps, reportWriteWarning, resetWriteWarningState, } from './safe-write.js';
export { findWriteArtifacts, describeWriteArtifacts } from './write-artifacts.js';
