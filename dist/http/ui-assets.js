/**
 * Loader for the built Mission Control UI (`dist/ui`), used by `monolith ui`.
 *
 * The HTTP transport (`server.ts`) imports no filesystem module on purpose, so
 * the static files are read here, once, at startup, into memory. The server
 * then serves them by exact key: a request path is never joined to a directory,
 * so path traversal has nothing to traverse.
 *
 * What is accepted: regular files only (no symlink, no special file, one link),
 * a fixed extension allowlist, a bounded directory depth, file count and size.
 * Anything else is skipped, except that a missing or unsafe `index.html` is an
 * error. Assets are read once; later changes on disk are not picked up.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
export class UiAssetsError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'UiAssetsError';
    }
}
const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};
const MAX_DEPTH = 3;
const MAX_FILES = 200;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
function readRegular(abs) {
    // lstat first so a symlink is refused rather than followed.
    const st = lstatSync(abs);
    if (!st.isFile() || st.nlink !== 1)
        return null;
    if (st.size > MAX_FILE_BYTES)
        throw new UiAssetsError('UI_BUILD_TOO_LARGE', `UI build file is larger than ${MAX_FILE_BYTES} bytes.`);
    const fd = openSync(abs, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const fst = fstatSync(fd);
        if (!fst.isFile() || fst.dev !== st.dev || fst.ino !== st.ino)
            return null;
        return readFileSync(fd);
    }
    finally {
        closeSync(fd);
    }
}
/** Reads `dir` (the built UI) into memory. Throws `UiAssetsError` if there is no usable `index.html`. */
export function loadUiAssets(dir) {
    const assets = new Map();
    let total = 0;
    const walk = (abs, rel, depth) => {
        for (const name of readdirSync(abs).sort()) {
            const childAbs = join(abs, name);
            const childRel = `${rel}/${name}`;
            const st = lstatSync(childAbs);
            if (st.isDirectory()) {
                if (depth < MAX_DEPTH)
                    walk(childAbs, childRel, depth + 1);
                continue;
            }
            const contentType = CONTENT_TYPES[extname(name).toLowerCase()];
            if (contentType === undefined)
                continue;
            const body = readRegular(childAbs);
            if (body === null)
                continue;
            total += body.length;
            if (assets.size >= MAX_FILES || total > MAX_TOTAL_BYTES) {
                throw new UiAssetsError('UI_BUILD_TOO_LARGE', 'UI build has too many or too large files.');
            }
            assets.set(childRel, { body, contentType });
        }
    };
    try {
        if (!lstatSync(dir).isDirectory())
            throw new UiAssetsError('UI_BUILD_MISSING', 'UI build directory is not a directory.');
        walk(dir, '', 0);
    }
    catch (err) {
        if (err instanceof UiAssetsError)
            throw err;
        if (err.code === 'ENOENT') {
            throw new UiAssetsError('UI_BUILD_MISSING', 'UI build directory does not exist.');
        }
        throw new UiAssetsError('UI_BUILD_UNSAFE', 'UI build directory could not be read safely.');
    }
    if (!assets.has('/index.html')) {
        throw new UiAssetsError('UI_BUILD_MISSING', 'UI build has no index.html.');
    }
    return assets;
}
