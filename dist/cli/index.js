#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * MONOLITH CLI entrypoint
 *
 * Commands:
 *   monolith init       — scaffold a new MONOLITH instance from templates/
 *   monolith validate   — run all enforcement + integrity checks
 *   monolith status     — show current protocol state and drift summary
 *   monolith dry-run    — run finalization gate without writing output
 */
import { MONOLITH_VERSION } from '../version.js';
const USAGE = `
monolith v${MONOLITH_VERSION}

Usage:
  monolith <command> [options]

Commands:
  init        Scaffold a new MONOLITH instance (.monolith/ + project files)
  validate    Run enforcement gates and integrity validators
  status      Show active protocol, phase, story, and drift summary
  dry-run     Simulate finalization gate — no writes, exit-code only

Options:
  --help, -h      Show this help
  --version, -v   Print version
`.trim();
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(USAGE);
        process.exit(0);
        return;
    }
    if (args.includes('--version') || args.includes('-v')) {
        console.log(MONOLITH_VERSION);
        process.exit(0);
        return;
    }
    const command = args[0];
    switch (command) {
        case 'init': {
            const { runInit } = await import('../init/index.js');
            const yes = args.includes('--yes') || args.includes('-y');
            await runInit({ targetDir: process.cwd(), yes });
            break;
        }
        case 'validate':
            console.error('monolith validate — not yet implemented (Phase 6)');
            process.exit(1);
            break;
        case 'status':
            console.error('monolith status — not yet implemented (Phase 6)');
            process.exit(1);
            break;
        case 'dry-run':
            console.error('monolith dry-run — not yet implemented (Phase 6)');
            process.exit(1);
            break;
        default:
            console.error(`Unknown command: ${command}\n`);
            console.log(USAGE);
            process.exit(1);
    }
}
main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
