/* eslint-disable no-console */
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
import { spawn } from 'child_process';
import { existsSync, lstatSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { startDashboardServer, loadUiAssets, UiAssetsError } from '../http/index.js';
import { RootContainmentError, resolveMonolithRoot } from '../root/index.js';
import { DEFAULT_DEV_UI_PORT, DEFAULT_UI_PORT, UI_DEV_USAGE, UI_USAGE, parseUiArgs } from './ui-args.js';
/** Thrown for expected, user-fixable failures. */
export class UiLaunchError extends Error {
}
const moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_UI_DIR = resolve(moduleDir, '..', 'ui');
const DEFAULT_PACKAGE_ROOT = resolve(moduleDir, '..', '..');
/** The project must be a MONOLITH instance: contained `monolithRoot` that exists as a real directory. */
export function assertMonolithProject(projectRoot) {
    let rootAbs;
    try {
        rootAbs = resolveMonolithRoot(projectRoot).rootAbs;
    }
    catch (err) {
        if (err instanceof RootContainmentError) {
            throw new UiLaunchError(`Not a usable MONOLITH project: ${err.message}`);
        }
        throw new UiLaunchError(`Cannot inspect the project at ${projectRoot}.`);
    }
    let isDir = false;
    try {
        isDir = lstatSync(rootAbs).isDirectory();
    }
    catch {
        // reported below
    }
    if (!isDir) {
        throw new UiLaunchError(`No MONOLITH instance found in ${projectRoot} (expected directory ${rootAbs}). Run 'monolith init' here, or cd into a MONOLITH project.`);
    }
}
async function listen(projectRoot, port, assets) {
    try {
        return await startDashboardServer({ projectRoot, port, assets });
    }
    catch (err) {
        const code = err.code;
        if (code === 'EADDRINUSE') {
            throw new UiLaunchError(`Port ${port} is already in use. Choose another with --port N.`);
        }
        if (code === 'EACCES') {
            throw new UiLaunchError(`Not permitted to listen on port ${port}. Choose another with --port N.`);
        }
        throw new UiLaunchError(`Could not start the server: ${err instanceof Error ? err.message : String(err)}`);
    }
}
export async function launchUi(opts) {
    const projectRoot = resolve(opts.projectRoot ?? process.cwd());
    const log = opts.log ?? ((line) => console.log(line));
    assertMonolithProject(projectRoot);
    let assets;
    try {
        assets = loadUiAssets(opts.uiDir ?? DEFAULT_UI_DIR);
    }
    catch (err) {
        if (err instanceof UiAssetsError) {
            throw new UiLaunchError(`Mission Control UI build is not usable: ${err.message} Reinstall the package, or run 'pnpm build:ui' in a source checkout.`);
        }
        throw err;
    }
    const server = await listen(projectRoot, opts.port, assets);
    log(`MONOLITH Mission Control: ${server.url}`);
    log(`Project: ${projectRoot}`);
    log('Read-only. Listening on 127.0.0.1 only. Press Ctrl+C to stop.');
    return {
        url: server.url,
        stop: () => server.close(),
        ended: new Promise(() => undefined),
    };
}
export async function launchUiDev(opts) {
    const projectRoot = resolve(opts.projectRoot ?? process.cwd());
    const packageRoot = opts.packageRoot ?? DEFAULT_PACKAGE_ROOT;
    const log = opts.log ?? ((line) => console.log(line));
    assertMonolithProject(projectRoot);
    const viteBin = join(packageRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    const viteConfig = join(packageRoot, 'ui', 'vite.config.ts');
    if (!existsSync(viteConfig) || !existsSync(viteBin)) {
        throw new UiLaunchError("'monolith ui dev' needs a source checkout of MONOLITH with devDependencies installed (ui/ and vite were not found). Use 'monolith ui' for the built interface.");
    }
    // The API takes any free port; Vite is told where it is through the env var its config reads.
    const api = await listen(projectRoot, 0);
    const child = spawn(process.execPath, [viteBin, '--config', viteConfig, '--host', '127.0.0.1', '--port', String(opts.port), '--strictPort'], { stdio: 'inherit', env: { ...process.env, MONOLITH_API_PORT: String(api.port) } });
    let childExited = false;
    const exited = new Promise((resolveExit) => {
        child.once('exit', (code, signal) => {
            childExited = true;
            resolveExit(code ?? (signal === null ? 1 : 0));
        });
        child.once('error', () => {
            childExited = true;
            resolveExit(1);
        });
    });
    let stopping = null;
    const stop = () => {
        stopping ??= (async () => {
            if (!childExited)
                child.kill('SIGTERM');
            await exited;
            await api.close();
        })();
        return stopping;
    };
    const ended = exited.then(async (code) => {
        await stop();
        return code;
    });
    log(`MONOLITH Mission Control (dev, HMR): http://127.0.0.1:${opts.port}`);
    log(`Project: ${projectRoot}  (dashboard API on ${api.url}, read-only)`);
    log('Listening on 127.0.0.1 only. Press Ctrl+C to stop.');
    return { url: `http://127.0.0.1:${opts.port}`, stop, ended };
}
/** CLI entry for `monolith ui ...`. Resolves with the process exit code once the launch has ended. */
export async function runUi(args) {
    const parsed = parseUiArgs(args);
    if (!parsed.ok) {
        console.error(`${parsed.message}\n\n${UI_USAGE}`);
        return 1;
    }
    if (parsed.help) {
        console.log(parsed.dev ? UI_DEV_USAGE : UI_USAGE);
        return 0;
    }
    // Handlers go in before anything starts listening, so a signal that arrives right after the
    // "listening" line can never hit the default action (killed by signal, exit code null).
    let handle = null;
    let signalled = false;
    let finish = () => undefined;
    const result = new Promise((resolveCode) => {
        let done = false;
        finish = (code) => {
            if (done)
                return;
            done = true;
            resolveCode(code);
        };
    });
    const onSignal = () => {
        signalled = true;
        if (handle !== null)
            void handle.stop().then(() => finish(0), () => finish(1));
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    try {
        handle = parsed.dev
            ? await launchUiDev({ port: parsed.port ?? DEFAULT_DEV_UI_PORT })
            : await launchUi({ port: parsed.port ?? DEFAULT_UI_PORT });
    }
    catch (err) {
        if (err instanceof UiLaunchError) {
            console.error(err.message);
            return 1;
        }
        throw err;
    }
    void handle.ended.then(finish);
    if (signalled)
        onSignal();
    return result;
}
