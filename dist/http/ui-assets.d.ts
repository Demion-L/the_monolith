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
import type { UiAssets } from './server.js';
export type UiAssetsErrorCode = 'UI_BUILD_MISSING' | 'UI_BUILD_UNSAFE' | 'UI_BUILD_TOO_LARGE';
export declare class UiAssetsError extends Error {
    readonly code: UiAssetsErrorCode;
    constructor(code: UiAssetsErrorCode, message: string);
}
/** Reads `dir` (the built UI) into memory. Throws `UiAssetsError` if there is no usable `index.html`. */
export declare function loadUiAssets(dir: string): UiAssets;
//# sourceMappingURL=ui-assets.d.ts.map