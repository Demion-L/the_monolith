/**
 * Safe write primitive (SEC-001B.2, ADR-012).
 *
 * The one code path that PUBLISHES project files (creates a new one or replaces
 * an existing one). It adds, for every write:
 *
 *  - an explicit WRITE BOUNDARY (`projectBoundary` / `trustedDirectoryBoundary`);
 *    there is no boundary-less write;
 *  - refusal of symlinks anywhere below the boundary, including symlinks that
 *    stay inside the project (W-SYM), of non-regular destinations (FIFO,
 *    device, directory) and of hardlinked destinations (`nlink > 1`);
 *  - a temp file opened `O_CREAT|O_EXCL|O_NOFOLLOW` (where the platform has
 *    `O_NOFOLLOW`) and published atomically: `rename()` over a regular file
 *    (`replaceFile`) or `link()` to a name that must not exist (`createFile`);
 *  - explicit PUBLICATION STATES. A failed write is NOT_PUBLISHED or UNKNOWN; a
 *    write that reached the final name is PUBLISHED and never throws. The state
 *    is decided from the identity (`dev/ino`) of the destination and of the
 *    temp name, never from an error code. UNKNOWN is never retried and never
 *    silently downgraded;
 *  - identity-checked cleanup: only a temp file THIS call created, and only if
 *    the name still shows the `dev/ino` recorded from the descriptor.
 *
 * Not routed through here: lock release and stale-lock recovery (`lock.ts`)
 * unlink the lock path directly, and `trusted-directory` scope creates its
 * directory with `mkdirSync`; see ADR-012 "Single primitive".
 *
 * What this module does NOT do — and must not be described as doing: it does
 * not defend against a local actor who swaps directories or symlinks
 * concurrently with an operation (SEC-001B.3). `ParentRef` is a path plus a
 * `dev/ino` snapshot; re-checking it before an operation is a diagnostic
 * tripwire, not protection, because the operation resolves the path again.
 * Likewise the final `unlink` of an owned temp file cannot be made conditional
 * without `unlinkat`/dirfd: a name swapped between the identity check and the
 * unlink is a residual race.
 *
 * Platform: guarantees are stated for POSIX. Where `O_NOFOLLOW` or directory
 * fsync is missing (Windows) the checks that can still be done with
 * `lstat`/`fstat` are done, and a PLATFORM_BEST_EFFORT warning is returned.
 */
import * as fs from 'fs';
import { randomBytes } from 'crypto';
import { isAbsolute, join, relative, resolve, sep } from 'path';
export class SafeWriteError extends Error {
    code;
    phase;
    publication;
    path;
    tmp;
    cause;
    constructor(message, init) {
        super(message);
        this.name = 'SafeWriteError';
        this.code = init.code;
        this.phase = init.phase;
        this.publication = init.publication;
        this.path = init.path;
        this.tmp = init.tmp;
        this.cause = init.cause;
    }
}
export function detectPlatformCaps() {
    const posix = process.platform !== 'win32';
    return {
        // `typeof` on purpose: on Windows the constant is `undefined` and
        // `flags | undefined` would silently drop it.
        noFollow: typeof fs.constants.O_NOFOLLOW === 'number',
        dirFsync: posix,
        ownerCheck: typeof process.geteuid === 'function',
        posix,
    };
}
export const realFsOps = {
    openSync: fs.openSync,
    writeSync: fs.writeSync,
    fchmodSync: fs.fchmodSync,
    fstatSync: fs.fstatSync,
    fsyncSync: fs.fsyncSync,
    closeSync: fs.closeSync,
    renameSync: fs.renameSync,
    linkSync: fs.linkSync,
    unlinkSync: fs.unlinkSync,
    lstatSync: fs.lstatSync,
    mkdirSync: fs.mkdirSync,
};
function ctxOf(o) {
    return {
        ops: { ...realFsOps, ...(o?.ops ?? {}) },
        caps: { ...detectPlatformCaps(), ...(o?.caps ?? {}) },
    };
}
function errnoOf(err) {
    return err?.code;
}
function errMsg(err) {
    return err instanceof Error ? err.message : String(err);
}
function bigLstat(ctx, p) {
    return ctx.ops.lstatSync(p, { bigint: true });
}
/** `null` when the path does not exist; any other error propagates. */
function bigLstatOrNull(ctx, p) {
    try {
        return bigLstat(ctx, p);
    }
    catch (err) {
        if (errnoOf(err) === 'ENOENT')
            return null;
        throw err;
    }
}
function sameId(st, dev, ino) {
    return st.dev === dev && st.ino === ino;
}
function platformWarnings(ctx) {
    if (ctx.caps.posix && ctx.caps.noFollow)
        return [];
    return [
        {
            code: 'PLATFORM_BEST_EFFORT',
            message: 'Write-protection guarantees are stated for POSIX only; on this platform symlink/special-file/hardlink checks ' +
                'are best-effort and unverified (ADR-012).',
        },
    ];
}
function codeForErrno(err, fallback = 'WRITE_FAILED') {
    switch (errnoOf(err)) {
        case 'EROFS':
            return 'WRITE_READONLY';
        case 'EACCES':
        case 'EPERM':
            return 'WRITE_PERMISSION';
        case 'ENOSPC':
        case 'EDQUOT':
            return 'WRITE_NO_SPACE';
        default:
            return fallback;
    }
}
const boundaryData = new WeakMap();
/**
 * Trust boundary of a write. Created only by `projectBoundary` /
 * `trustedDirectoryBoundary`. In both modes the ANCESTORS of the boundary are
 * trusted (in `project` mode: the root the user pointed at; in
 * `trusted-directory` mode: because the caller asserts it); every component
 * below the boundary is checked.
 */
export class WriteBoundary {
    constructor() {
        /* created via the factory functions only */
    }
    get mode() {
        return dataOf(this).mode;
    }
    /** @internal */
    static create(mode, dir) {
        if (typeof dir !== 'string' || dir.length === 0) {
            throw new SafeWriteError('write boundary requires a non-empty directory path.', {
                code: 'WRITE_BOUNDARY_INVALID',
                phase: 'boundary',
                publication: 'NOT_PUBLISHED',
                path: String(dir),
            });
        }
        const lexical = resolve(dir);
        let realDir;
        try {
            realDir = fs.realpathSync(lexical);
            if (!fs.statSync(realDir).isDirectory())
                throw new Error('not a directory');
        }
        catch (err) {
            throw new SafeWriteError(`write boundary "${lexical}" cannot be resolved to a directory: ${errMsg(err)}`, {
                code: 'WRITE_BOUNDARY_INVALID',
                phase: 'boundary',
                publication: 'NOT_PUBLISHED',
                path: lexical,
                cause: err,
            });
        }
        const b = new WriteBoundary();
        boundaryData.set(b, { mode, lexical, realDir });
        return b;
    }
}
function dataOf(b) {
    const d = boundaryData.get(b);
    if (!d)
        throw new TypeError('not a WriteBoundary; use projectBoundary() or trustedDirectoryBoundary()');
    return d;
}
/** Project scope: `projectRoot` is the boundary; target directories must lie inside it. */
export function projectBoundary(projectRoot) {
    return WriteBoundary.create('project', projectRoot);
}
/** Trusted-directory scope: the caller asserts `dir` and ALL its ancestors are trusted. */
export function trustedDirectoryBoundary(dir) {
    return WriteBoundary.create('trusted-directory', dir);
}
const parentData = new WeakMap();
/**
 * A verified directory below a boundary. Opaque on purpose: code outside this
 * module must not read its path. Today it is a path with a `dev/ino` snapshot;
 * SEC-001B.3 may replace it with a directory descriptor. It is NOT a security
 * handle (see the module comment).
 */
export class ParentRef {
    constructor() {
        /* created by openParent only */
    }
    /** @internal */
    static create(data) {
        const p = new ParentRef();
        parentData.set(p, data);
        return p;
    }
}
/**
 * Absolute path of the boundary a verified parent lies below, for the READ side
 * of the same trust decision (SEC-001B.1-R): a lock file is read under the
 * boundary its staging files are written under. Not a handle; a path.
 */
export function boundaryPathOf(p) {
    return dataOf(pdata(p).boundary).lexical;
}
function pdata(p) {
    const d = parentData.get(p);
    if (!d)
        throw new TypeError('not a ParentRef');
    return d;
}
/** Relative segments of `dirAbs` below the boundary, or `null` if outside. */
function segmentsBelow(b, dirAbs) {
    const abs = resolve(dirAbs);
    for (const base of [b.lexical, b.realDir]) {
        const rel = relative(base, abs);
        if (rel === '')
            return [];
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
            continue;
        return rel.split(sep).filter((s) => s.length > 0);
    }
    return null;
}
function outsideError(b, abs) {
    return new SafeWriteError(`"${abs}" is outside the ${b.mode} write boundary "${b.lexical}"; refusing to write.`, { code: 'WRITE_OUTSIDE_BOUNDARY', phase: 'boundary', publication: 'NOT_PUBLISHED', path: abs });
}
/**
 * Walk `dirAbs` below the boundary, `lstat`-ing every component: it must be a
 * real directory, never a symlink (W-SYM) — including a symlink that stays
 * inside the project. Missing components are created only with `create`.
 */
export function openParent(boundary, dirAbs, opts = {}) {
    const ctx = ctxOf(opts);
    const b = dataOf(boundary);
    const abs = resolve(dirAbs);
    const segs = segmentsBelow(b, abs);
    if (segs === null)
        throw outsideError(b, abs);
    let current = b.realDir;
    for (const seg of segs) {
        const next = join(current, seg);
        let st = bigLstatOrNullSafe(ctx, next, abs);
        if (st === null) {
            if (!opts.create) {
                throw new SafeWriteError(`directory "${next}" does not exist.`, {
                    code: 'WRITE_PARENT_MISSING',
                    phase: 'parent',
                    publication: 'NOT_PUBLISHED',
                    path: next,
                });
            }
            try {
                ctx.ops.mkdirSync(next);
            }
            catch (err) {
                if (errnoOf(err) !== 'EEXIST') {
                    throw new SafeWriteError(`cannot create directory "${next}": ${errMsg(err)}`, {
                        code: codeForErrno(err),
                        phase: 'mkdir',
                        publication: 'NOT_PUBLISHED',
                        path: next,
                        cause: err,
                    });
                }
            }
            // Re-inspect: whatever is there now (ours, or planted concurrently) is judged the same way.
            st = bigLstatOrNullSafe(ctx, next, abs);
            if (st === null) {
                throw new SafeWriteError(`directory "${next}" disappeared right after it was created.`, {
                    code: 'WRITE_PARENT_CHANGED',
                    phase: 'parent',
                    publication: 'NOT_PUBLISHED',
                    path: next,
                });
            }
        }
        assertDirectoryEntry(st, next);
        current = next;
    }
    const st = bigLstatOrNullSafe(ctx, current, abs);
    if (st === null) {
        throw new SafeWriteError(`directory "${current}" does not exist.`, {
            code: 'WRITE_PARENT_MISSING',
            phase: 'parent',
            publication: 'NOT_PUBLISHED',
            path: current,
        });
    }
    assertDirectoryEntry(st, current);
    return ParentRef.create({ path: current, dev: st.dev, ino: st.ino, boundary });
}
function bigLstatOrNullSafe(ctx, p, whole) {
    try {
        return bigLstatOrNull(ctx, p);
    }
    catch (err) {
        throw new SafeWriteError(`cannot inspect "${p}" (while resolving "${whole}"): ${errMsg(err)}`, {
            code: codeForErrno(err),
            phase: 'parent',
            publication: 'NOT_PUBLISHED',
            path: p,
            cause: err,
        });
    }
}
function assertDirectoryEntry(st, p) {
    if (st.isSymbolicLink()) {
        throw new SafeWriteError(`"${p}" is a symbolic link. Writes refuse symlinks below the write boundary, even ones that stay inside the ` +
            'project (W-SYM, ADR-012); replace the link with a real directory.', { code: 'WRITE_PARENT_SYMLINK', phase: 'parent', publication: 'NOT_PUBLISHED', path: p });
    }
    if (!st.isDirectory()) {
        throw new SafeWriteError(`"${p}" exists but is not a directory.`, {
            code: 'WRITE_PARENT_NOT_DIRECTORY',
            phase: 'parent',
            publication: 'NOT_PUBLISHED',
            path: p,
        });
    }
}
/**
 * Tripwire, not protection: detects a parent that was swapped BEFORE this
 * check. The operation that follows resolves the path again.
 */
function assertParentUnchanged(parent, ctx) {
    const d = pdata(parent);
    let st;
    try {
        st = bigLstatOrNull(ctx, d.path);
    }
    catch (err) {
        throw new SafeWriteError(`cannot re-inspect directory "${d.path}": ${errMsg(err)}`, {
            code: codeForErrno(err, 'WRITE_PARENT_CHANGED'),
            phase: 'parent-recheck',
            publication: 'NOT_PUBLISHED',
            path: d.path,
            cause: err,
        });
    }
    if (st === null || !st.isDirectory() || !sameId(st, d.dev, d.ino)) {
        throw new SafeWriteError(`directory "${d.path}" changed while the write was being prepared.`, {
            code: 'WRITE_PARENT_CHANGED',
            phase: 'parent-recheck',
            publication: 'NOT_PUBLISHED',
            path: d.path,
        });
    }
}
/**
 * Read-only: classify what is at `fileAbs` without writing. Missing parent
 * directories make the target `free` (they would be created). A dangling
 * symlink is a `symlink`, never `free`.
 */
export function probeTarget(boundary, fileAbs, opts = {}) {
    const ctx = ctxOf(opts);
    const b = dataOf(boundary);
    const abs = resolve(fileAbs);
    const segs = segmentsBelow(b, abs);
    if (segs === null || segs.length === 0)
        return { state: 'outside', path: abs };
    let current = b.realDir;
    for (let i = 0; i < segs.length; i++) {
        const next = join(current, segs[i]);
        let st;
        try {
            st = bigLstatOrNull(ctx, next);
        }
        catch (err) {
            return { state: 'unreadable', path: next, detail: errMsg(err) };
        }
        if (st === null)
            return { state: 'free', path: abs };
        const last = i === segs.length - 1;
        if (!last) {
            if (st.isSymbolicLink())
                return { state: 'parent-symlink', path: next };
            if (!st.isDirectory())
                return { state: 'parent-not-directory', path: next };
            current = next;
            continue;
        }
        if (st.isSymbolicLink())
            return { state: 'symlink', path: next };
        if (!st.isFile())
            return { state: 'special', path: next };
        return { state: 'exists', path: next };
    }
    return { state: 'free', path: abs };
}
function openFlags(ctx) {
    const c = fs.constants;
    return c.O_WRONLY | c.O_CREAT | c.O_EXCL | (ctx.caps.noFollow ? c.O_NOFOLLOW : 0);
}
/**
 * Create a brand-new file `name` in `parent`: `O_CREAT|O_EXCL|O_NOFOLLOW` at
 * `mode`. Success proves this call created it; its identity is recorded
 * immediately. If the identity cannot be recorded, ownership is NOT claimed:
 * the descriptor is closed, the file is left alone and the error says so.
 */
export function createExclusive(parent, name, mode, opts = {}) {
    const ctx = ctxOf(opts);
    const d = pdata(parent);
    const path = join(d.path, name);
    assertParentUnchanged(parent, ctx);
    let fd;
    try {
        fd = ctx.ops.openSync(path, openFlags(ctx), mode);
    }
    catch (err) {
        if (errnoOf(err) === 'EEXIST') {
            throw new SafeWriteError(`temporary name "${path}" is already taken; refusing to reuse it.`, {
                code: 'WRITE_TMP_COLLISION',
                phase: 'create',
                publication: 'NOT_PUBLISHED',
                path,
                cause: err,
            });
        }
        if (errnoOf(err) === 'ELOOP') {
            throw new SafeWriteError(`"${path}" is a symbolic link; refusing to write through it.`, {
                code: 'WRITE_TARGET_SYMLINK',
                phase: 'create',
                publication: 'NOT_PUBLISHED',
                path,
                cause: err,
            });
        }
        throw new SafeWriteError(`cannot create "${path}": ${errMsg(err)}`, {
            code: codeForErrno(err),
            phase: 'create',
            publication: 'NOT_PUBLISHED',
            path,
            cause: err,
        });
    }
    let st;
    try {
        st = ctx.ops.fstatSync(fd, { bigint: true });
        if (!ctx.caps.noFollow) {
            // No O_NOFOLLOW: the path must still be the very file we just created.
            const at = bigLstat(ctx, path);
            if (at.isSymbolicLink() || !sameId(at, st.dev, st.ino))
                throw new Error('path no longer names the created file');
        }
    }
    catch (err) {
        safeClose(ctx, fd);
        throw new SafeWriteError(`created "${path}" but could not confirm its identity, so it is left in place untouched: ${errMsg(err)}`, {
            code: 'WRITE_VERIFY_FAILED',
            phase: 'create',
            publication: 'NOT_PUBLISHED',
            path,
            tmp: { name, owned: false, removed: null },
            cause: err,
        });
    }
    return { fd, token: { name, dev: st.dev, ino: st.ino } };
}
function safeClose(ctx, fd) {
    try {
        ctx.ops.closeSync(fd);
    }
    catch {
        /* best effort */
    }
}
/**
 * Remove `token`'s file iff the name still shows the recorded identity. Never
 * removes anything else. The unlink itself is not conditional (no `unlinkat`):
 * a name swapped between the check and the unlink is a residual race.
 */
export function disposeOwned(parent, token, opts = {}) {
    const ctx = ctxOf(opts);
    const path = join(pdata(parent).path, token.name);
    let st;
    try {
        st = bigLstatOrNull(ctx, path);
    }
    catch {
        return 'failed';
    }
    if (st === null)
        return 'absent';
    if (!st.isFile() || !sameId(st, token.dev, token.ino))
        return 'not-owned';
    try {
        ctx.ops.unlinkSync(path);
        return 'removed';
    }
    catch (err) {
        return errnoOf(err) === 'ENOENT' ? 'absent' : 'failed';
    }
}
function tmpInfo(res, name) {
    switch (res) {
        case 'removed':
        case 'absent':
            return { name, owned: true, removed: true };
        case 'not-owned':
            return { name, owned: false, removed: false };
        case 'failed':
            return { name, owned: true, removed: false };
    }
}
function residueNote(info, dir) {
    if (info.removed)
        return '';
    return info.owned
        ? ` The temporary file "${info.name}" in "${dir}" could not be removed and was left in place.`
        : ` The temporary file "${info.name}" in "${dir}" no longer matches the file this call created, so it was NOT removed.`;
}
function toBuffer(data) {
    return typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
}
function tempName(finalName) {
    return `${finalName}.tmp.${process.pid}.${randomBytes(8).toString('hex')}`;
}
function validName(name, parent) {
    if (name.length === 0 || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
        throw new SafeWriteError(`invalid file name "${name}".`, {
            code: 'WRITE_OUTSIDE_BOUNDARY',
            phase: 'validate',
            publication: 'NOT_PUBLISHED',
            path: join(pdata(parent).path, name),
        });
    }
}
function inspectTarget(parent, name, ctx, mode) {
    const path = join(pdata(parent).path, name);
    let st;
    try {
        st = bigLstatOrNull(ctx, path);
    }
    catch (err) {
        throw new SafeWriteError(`cannot inspect "${path}": ${errMsg(err)}`, {
            code: codeForErrno(err),
            phase: 'validate',
            publication: 'NOT_PUBLISHED',
            path,
            cause: err,
        });
    }
    if (st === null)
        return { existing: null };
    if (st.isSymbolicLink()) {
        throw new SafeWriteError(`"${path}" is a symbolic link (possibly dangling); writes refuse symlinks (W-SYM, ADR-012). Remove the link yourself.`, { code: 'WRITE_TARGET_SYMLINK', phase: 'validate', publication: 'NOT_PUBLISHED', path });
    }
    if (!st.isFile()) {
        throw new SafeWriteError(`"${path}" exists but is not a regular file (FIFO, device, socket or directory).`, {
            code: 'WRITE_TARGET_NOT_REGULAR',
            phase: 'validate',
            publication: 'NOT_PUBLISHED',
            path,
        });
    }
    if (mode === 'create') {
        throw new SafeWriteError(`"${path}" already exists; it is never overwritten.`, {
            code: 'WRITE_TARGET_EXISTS',
            phase: 'validate',
            publication: 'NOT_PUBLISHED',
            path,
        });
    }
    if (st.nlink > 1n) {
        throw new SafeWriteError(`"${path}" has ${st.nlink} hard links; replacing it would silently detach them, so the write is refused. ` +
            'Make it a standalone copy (for example copy it to a new file and rename that over it), then retry.', { code: 'WRITE_TARGET_HARDLINKED', phase: 'validate', publication: 'NOT_PUBLISHED', path });
    }
    return { existing: st };
}
/**
 * Steps 1-5b of the durability order: create, write, fchmod, verify the
 * descriptor, fsync the file, close. Any failure leaves the destination
 * untouched and removes the temp file only if ownership still verifies.
 */
function stage(parent, finalName, data, finalMode, createMode, fsyncFile, ctx) {
    const dir = pdata(parent).path;
    const owned = createExclusive(parent, tempName(finalName), createMode, { ops: ctx.ops, caps: ctx.caps });
    const { fd, token } = owned;
    const tmpPath = join(dir, token.name);
    let closed = false;
    const abort = (code, phase, what, cause) => {
        if (!closed)
            safeClose(ctx, fd);
        closed = true;
        const info = tmpInfo(disposeOwned(parent, token, { ops: ctx.ops, caps: ctx.caps }), token.name);
        throw new SafeWriteError(`${what}: ${errMsg(cause)}.${residueNote(info, dir)}`, {
            code,
            phase,
            publication: 'NOT_PUBLISHED',
            path: tmpPath,
            tmp: info,
            cause,
        });
    };
    try {
        let off = 0;
        while (off < data.length) {
            const n = ctx.ops.writeSync(fd, data, off, data.length - off);
            if (!(n > 0))
                throw new Error(`write returned ${n} with ${data.length - off} bytes unwritten`);
            off += n;
        }
    }
    catch (err) {
        return abort(codeForErrno(err), 'write', `cannot write "${tmpPath}"`, err);
    }
    if (finalMode !== null) {
        try {
            ctx.ops.fchmodSync(fd, finalMode);
        }
        catch (err) {
            return abort(codeForErrno(err), 'chmod', `cannot set the mode of "${tmpPath}"`, err);
        }
    }
    try {
        const st = ctx.ops.fstatSync(fd, { bigint: true });
        if (!st.isFile())
            throw new Error('not a regular file');
        if (st.nlink !== 1n)
            throw new Error(`link count is ${st.nlink}`);
        if (st.size !== BigInt(data.length))
            throw new Error(`size is ${st.size}, expected ${data.length}`);
        if (!sameId(st, token.dev, token.ino))
            throw new Error('identity changed');
        if (finalMode !== null && (Number(st.mode) & 0o777) !== finalMode)
            throw new Error('mode does not match');
        if (ctx.caps.ownerCheck && Number(st.uid) !== process.geteuid())
            throw new Error('not owned by the effective user');
    }
    catch (err) {
        return abort('WRITE_VERIFY_FAILED', 'verify', `temporary file "${tmpPath}" failed verification`, err);
    }
    if (fsyncFile) {
        try {
            ctx.ops.fsyncSync(fd);
        }
        catch (err) {
            // Never retried: after an fsync error the state of the pages is undefined.
            return abort('WRITE_FSYNC_FAILED', 'fsync', `cannot fsync "${tmpPath}"`, err);
        }
    }
    try {
        closed = true;
        ctx.ops.closeSync(fd);
    }
    catch (err) {
        return abort(codeForErrno(err), 'close', `cannot close "${tmpPath}"`, err);
    }
    return { token, tmpPath };
}
function isOurs(st, staged) {
    return st !== null && st.isFile() && sameId(st, staged.token.dev, staged.token.ino);
}
/**
 * One read-only look at the two names after a publish call failed. NO errno is
 * taken as proof that the destination is untouched: an error can be reported
 * for an operation that took effect (a lost reply), and which errors can follow
 * success depends on the filesystem, so the decision is made from identity
 * (`dev/ino` recorded from the descriptor), never from the error code.
 *
 *  - the destination is our file                          -> `published`;
 *  - the temp name is still our file and the destination is not
 *    (`link`+`EEXIST`: the name is held by something else) -> `lost-race`, else
 *    `not-published`;
 *  - anything else, or a failed inspection                  -> `unknown`.
 *
 * For `link`+`EEXIST` the link count of the temp file is deliberately NOT
 * evidence: a second hard link to the temp name (a backup tool, another actor)
 * would otherwise make a foreign destination look like ours.
 * Never retries the publish and never removes anything.
 */
function verifyPublication(kind, errno, targetPath, staged, ctx) {
    try {
        const t = bigLstatOrNull(ctx, targetPath);
        if (isOurs(t, staged))
            return 'published';
        const m = bigLstatOrNull(ctx, staged.tmpPath);
        if (isOurs(m, staged)) {
            if (kind === 'link' && errno === 'EEXIST') {
                // Held by another object, or it vanished again while our temp name was
                // never linked (link count 1): either way nothing of ours was published.
                if (t !== null || m.nlink === 1n)
                    return 'lost-race';
                return 'unknown';
            }
            return 'not-published';
        }
    }
    catch {
        /* the verification itself failed: undecided */
    }
    return 'unknown';
}
function publishFailure(kind, err, parent, staged, targetPath, ctx, warnings) {
    const dir = pdata(parent).path;
    const errno = errnoOf(err);
    const notPublished = (code, what) => {
        const info = tmpInfo(disposeOwned(parent, staged.token, { ops: ctx.ops, caps: ctx.caps }), staged.token.name);
        throw new SafeWriteError(`${what}: ${errMsg(err)}. The destination was not modified.${residueNote(info, dir)}`, {
            code,
            phase: 'publish',
            publication: 'NOT_PUBLISHED',
            path: targetPath,
            tmp: info,
            cause: err,
        });
    };
    const verdict = verifyPublication(kind, errno, targetPath, staged, ctx);
    if (verdict === 'published') {
        warnings.push({
            code: 'PUBLICATION_VERIFIED_AFTER_ERROR',
            message: `${kind} reported "${errMsg(err)}" but the destination holds the new file; treated as published.`,
            path: targetPath,
        });
        return 'published';
    }
    if (verdict === 'lost-race')
        return 'lost-race';
    if (verdict === 'not-published') {
        if (kind === 'link' && (errno === 'EPERM' || errno === 'EXDEV')) {
            return notPublished('WRITE_LINK_UNSUPPORTED', `the filesystem does not support hard links here`);
        }
        return notPublished(codeForErrno(err), `cannot publish "${targetPath}"`);
    }
    throw new SafeWriteError(`could not determine whether "${targetPath}" was written (${kind} failed with: ${errMsg(err)}). ` +
        `Check its current state before repeating the operation; nothing was retried or removed` +
        ` (temporary file: "${staged.tmpPath}").`, {
        code: 'WRITE_PUBLICATION_UNKNOWN',
        phase: 'publish',
        publication: 'UNKNOWN',
        path: targetPath,
        tmp: { name: staged.token.name, owned: true, removed: false },
        cause: err,
    });
}
/**
 * Publish an owned, completely written and closed temp file under `finalName`
 * with `link()`, which fails if the name exists (symlink, FIFO or file alike).
 * `lost-race`: somebody else owns the name — nothing of ours was published
 * (the temp file is NOT removed here; the caller disposes it). Errors follow
 * the publication-state rules in the module comment.
 */
export function publishLink(parent, token, finalName, opts = {}) {
    const ctx = ctxOf(opts);
    validName(finalName, parent);
    const dir = pdata(parent).path;
    const staged = { token, tmpPath: join(dir, token.name) };
    const targetPath = join(dir, finalName);
    const warnings = [];
    assertParentUnchanged(parent, ctx);
    try {
        ctx.ops.linkSync(staged.tmpPath, targetPath);
        return { outcome: 'published', warnings };
    }
    catch (err) {
        return { outcome: publishFailure('link', err, parent, staged, targetPath, ctx, warnings), warnings };
    }
}
/** fsync the directory. Returns what was reached; failures become warnings. */
function syncDirectory(parent, ctx, warnings) {
    const dir = pdata(parent).path;
    if (!ctx.caps.dirFsync)
        return 'file';
    const c = fs.constants;
    let fd = null;
    try {
        fd = ctx.ops.openSync(dir, c.O_RDONLY | (c.O_DIRECTORY ?? 0));
        ctx.ops.fsyncSync(fd);
        return 'full';
    }
    catch (err) {
        const errno = errnoOf(err);
        if (errno !== undefined && ['EINVAL', 'ENOTSUP', 'ENOSYS', 'EPERM', 'EACCES', 'EBADF', 'EISDIR', 'ENOTDIR'].includes(errno)) {
            warnings.push({
                code: 'DIR_FSYNC_UNSUPPORTED',
                message: `directory fsync is not supported here (${errno}); the file is durable, the directory entry may not be.`,
                path: dir,
            });
            return 'file';
        }
        warnings.push({
            code: 'DIR_FSYNC_FAILED',
            message: `directory fsync failed (${errMsg(err)}); the write is published but its durability is unknown.`,
            path: dir,
        });
        return 'unknown';
    }
    finally {
        if (fd !== null)
            safeClose(ctx, fd);
    }
}
function checkSize(path, data, max) {
    if (max !== undefined && data.length > max) {
        throw new SafeWriteError(`refusing to write ${data.length} bytes to "${path}": the limit is ${max}.`, {
            code: 'WRITE_TOO_LARGE',
            phase: 'validate',
            publication: 'NOT_PUBLISHED',
            path,
        });
    }
}
function plan(opts) {
    const requested = opts.durability ?? 'full';
    return {
        finalExact: opts.exactMode !== false,
        fsyncFile: requested !== 'none',
        fsyncDir: requested === 'full',
        requested,
    };
}
function reached(requested, dir) {
    if (requested === 'none')
        return 'none';
    if (requested === 'file')
        return 'file';
    return dir;
}
/**
 * Atomically replace `name` in `parent` (or create it if absent): temp file ->
 * fsync -> `rename`. The destination must be absent or a regular file with a
 * single link; its mode is kept unless `preserveMode: false`. Throws
 * `SafeWriteError` (NOT_PUBLISHED / UNKNOWN); once published it never throws.
 */
export function replaceFile(parent, name, data, opts) {
    const ctx = ctxOf(opts);
    validName(name, parent);
    const buf = toBuffer(data);
    const dir = pdata(parent).path;
    const targetPath = join(dir, name);
    const p = plan(opts);
    checkSize(targetPath, buf, opts.maxBytes);
    assertParentUnchanged(parent, ctx);
    const { existing } = inspectTarget(parent, name, ctx, 'replace');
    let finalMode;
    if (existing && opts.preserveMode !== false)
        finalMode = Number(existing.mode) & 0o777;
    else
        finalMode = p.finalExact ? opts.mode : null;
    const warnings = platformWarnings(ctx);
    const staged = stage(parent, name, buf, finalMode, p.finalExact || existing ? 0o600 : opts.mode, p.fsyncFile, ctx);
    assertParentUnchangedOrDispose(parent, staged, ctx, targetPath);
    try {
        ctx.ops.renameSync(staged.tmpPath, targetPath);
    }
    catch (err) {
        publishFailure('rename', err, parent, staged, targetPath, ctx, warnings);
    }
    const dirReached = p.fsyncDir ? syncDirectory(parent, ctx, warnings) : 'file';
    return { publication: 'PUBLISHED', durability: reached(p.requested, dirReached), warnings };
}
function assertParentUnchangedOrDispose(parent, staged, ctx, targetPath) {
    try {
        assertParentUnchanged(parent, ctx);
    }
    catch (err) {
        const info = tmpInfo(disposeOwned(parent, staged.token, { ops: ctx.ops, caps: ctx.caps }), staged.token.name);
        if (err instanceof SafeWriteError) {
            throw new SafeWriteError(`${err.message}${residueNote(info, pdata(parent).path)}`, {
                code: err.code,
                phase: err.phase,
                publication: 'NOT_PUBLISHED',
                path: targetPath,
                tmp: info,
                cause: err.cause,
            });
        }
        throw err;
    }
}
/**
 * Create `name` in `parent` without ever overwriting: temp file -> fsync ->
 * `link()`, then the temp name is removed. The final name never shows a
 * partially written file. A destination that exists in any form (file,
 * symlink, FIFO, ...) is refused. Failures after the link succeeded are
 * warnings (`STAGING_RESIDUE`, directory fsync), never errors.
 */
export function createFile(parent, name, data, opts) {
    const ctx = ctxOf(opts);
    validName(name, parent);
    const buf = toBuffer(data);
    const dir = pdata(parent).path;
    const targetPath = join(dir, name);
    const p = plan(opts);
    checkSize(targetPath, buf, opts.maxBytes);
    assertParentUnchanged(parent, ctx);
    inspectTarget(parent, name, ctx, 'create');
    const warnings = platformWarnings(ctx);
    const staged = stage(parent, name, buf, p.finalExact ? opts.mode : null, p.finalExact ? 0o600 : opts.mode, p.fsyncFile, ctx);
    assertParentUnchangedOrDispose(parent, staged, ctx, targetPath);
    let outcome;
    try {
        ctx.ops.linkSync(staged.tmpPath, targetPath);
        outcome = 'published';
    }
    catch (err) {
        outcome = publishFailure('link', err, parent, staged, targetPath, ctx, warnings);
    }
    if (outcome === 'lost-race') {
        const info = tmpInfo(disposeOwned(parent, staged.token, { ops: ctx.ops, caps: ctx.caps }), staged.token.name);
        throw new SafeWriteError(`"${targetPath}" appeared while it was being created; it is never overwritten.${residueNote(info, dir)}`, {
            code: 'WRITE_TARGET_EXISTS',
            phase: 'publish',
            publication: 'NOT_PUBLISHED',
            path: targetPath,
            tmp: info,
        });
    }
    const removed = disposeOwned(parent, staged.token, { ops: ctx.ops, caps: ctx.caps });
    if (removed !== 'removed' && removed !== 'absent') {
        warnings.push({
            code: 'STAGING_RESIDUE',
            message: `"${staged.tmpPath}" is a second name of the published file and could not be removed (${removed}); the file itself is complete.`,
            path: staged.tmpPath,
        });
    }
    const dirReached = p.fsyncDir ? syncDirectory(parent, ctx, warnings) : 'file';
    return { publication: 'PUBLISHED', durability: reached(p.requested, dirReached), warnings };
}
// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
let platformNoticePrinted = false;
/**
 * Print a post-publication finding as one `warning` line (stderr by default).
 * The platform note is printed once per process, however many files are written.
 * Never throws: the write it reports on is already published.
 */
export function reportWriteWarning(warning, print = (line) => {
    process.stderr.write(`${line}\n`);
}) {
    try {
        if (warning.code === 'PLATFORM_BEST_EFFORT') {
            if (platformNoticePrinted)
                return;
            platformNoticePrinted = true;
        }
        print(`warning [${warning.code}]: ${warning.message}${warning.path ? ` (${warning.path})` : ''}`);
    }
    catch {
        /* ignored on purpose */
    }
}
/** Test-only: forget that the platform note was printed. */
export function resetWriteWarningState() {
    platformNoticePrinted = false;
}
