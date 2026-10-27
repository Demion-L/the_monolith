/**
 * `monolith ui` — launches Mission Control (ADR-010) for the project in the
 * current directory.
 *
 *   monolith ui       production: the built UI (dist/ui) and the read-only API on
 *                     one loopback port. No Vite, no devDependencies.
 *   monolith ui dev   development: the same API on a free loopback port plus a
 *                     Vite dev server (HMR) that proxies /api/dashboard to it.
 *
 * Nothing here writes to the project, runs project code or opens a browser.
 * Expected user errors are one line on stderr and exit code 1, never a stack.
 */
/** Thrown for expected, user-fixable failures. */
export declare class UiLaunchError extends Error {
}
export interface UiLaunchOptions {
    /** Project root (default: cwd). */
    projectRoot?: string;
    /** Directory of the built UI (default: `dist/ui` next to this module). */
    uiDir?: string;
    /** Source checkout root holding `ui/` and `node_modules/vite` (default: package root). */
    packageRoot?: string;
    /** Listen port; 0 = any free port (tests). */
    port: number;
    log?: (line: string) => void;
}
export interface UiHandle {
    readonly url: string;
    /** Stops everything this launch started and resolves when it is gone. */
    stop(): Promise<void>;
    /** Resolves with the exit code when the launch ends by itself (dev: Vite exited). */
    readonly ended: Promise<number>;
}
/** The project must be a MONOLITH instance: contained `monolithRoot` that exists as a real directory. */
export declare function assertMonolithProject(projectRoot: string): void;
export declare function launchUi(opts: UiLaunchOptions): Promise<UiHandle>;
export declare function launchUiDev(opts: UiLaunchOptions): Promise<UiHandle>;
/** CLI entry for `monolith ui ...`. Resolves with the process exit code once the launch has ended. */
export declare function runUi(args: string[]): Promise<number>;
//# sourceMappingURL=ui.d.ts.map