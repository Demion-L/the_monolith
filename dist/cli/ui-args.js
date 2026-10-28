export const DEFAULT_UI_PORT = 4173;
export const DEFAULT_DEV_UI_PORT = 5173;
export const UI_USAGE = `
Usage:
  monolith ui [--port N]       Serve Mission Control (read-only) for the project in the current directory
  monolith ui dev [--port N]   Mission Control with Vite hot reload (source checkout only)

Options:
  --port N     Port to listen on (1-65535). Default: ${DEFAULT_UI_PORT} (ui), ${DEFAULT_DEV_UI_PORT} (ui dev)
  --help, -h   Show this help

The server listens on 127.0.0.1 only; there is no option to change that.
`.trim();
export const UI_DEV_USAGE = `
Usage:
  monolith ui dev [--port N]

Development mode for Mission Control. Starts the read-only dashboard API on a
free loopback port for the project in the current directory, and a Vite dev
server with hot module reload that proxies /api/dashboard to it.

Requires a source checkout of MONOLITH with its devDependencies installed
(ui/ and vite are not part of the published package).

Options:
  --port N     Port of the Vite dev server (1-65535). Default: ${DEFAULT_DEV_UI_PORT}
  --help, -h   Show this help

Both servers listen on 127.0.0.1 only.
`.trim();
/**
 * Parses args after `monolith ui`. Anything that is not a known flag, the
 * `dev` subcommand or a valid value is an explicit error (never ignored).
 */
export function parseUiArgs(args) {
    let dev = false;
    let help = false;
    let port = null;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            help = true;
        }
        else if (arg === 'dev' && i === 0) {
            dev = true;
        }
        else if (arg === '--host' || arg.startsWith('--host=')) {
            return {
                ok: false,
                message: "'--host' is not supported: Mission Control listens on 127.0.0.1 only (ADR-010 G2) and has no authentication, so it must not be exposed to a network.",
            };
        }
        else if (arg === '--port' || arg.startsWith('--port=')) {
            const inline = arg.startsWith('--port=');
            const value = inline ? arg.slice('--port='.length) : args[++i];
            if (value === undefined || !/^\d{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
                return { ok: false, message: `Invalid --port value '${value ?? ''}': expected an integer from 1 to 65535.` };
            }
            port = Number(value);
        }
        else {
            return { ok: false, message: `Unknown argument for 'monolith ui${dev ? ' dev' : ''}': ${arg}` };
        }
    }
    return help ? { ok: true, help: true, dev } : { ok: true, help: false, dev, port };
}
