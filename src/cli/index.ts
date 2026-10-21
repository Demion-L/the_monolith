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
 *   monolith mission    — manage Tactical Coordinatorium mission lifecycle
 *   monolith brief       — deterministic, bounded project context summary
 */

import { MONOLITH_VERSION } from '../version.js';
import { parseInitArgs } from './init-args.js';

const USAGE = `
monolith v${MONOLITH_VERSION}

Usage:
  monolith <command> [options]

Commands:
  init        Scaffold a new MONOLITH instance in the current directory.
              No positional target-directory argument; refuses to run if it
              would overwrite any existing tracked file (--yes only skips
              interactive prompts, it does not force an overwrite).
  validate    Run enforcement gates and integrity validators
  status      Show active protocol, phase, story, and drift summary
  dry-run     Simulate finalization gate — no writes, exit-code only
  mission     Manage Tactical Coordinatorium missions (start/list/show/finish/checkpoint/checkpoints)
  brief       Print a deterministic, bounded summary of project state (Story,
              active Missions, latest Checkpoints, mandatory Protocols,
              accepted ADRs) — read-only, no LLM/network/ERG involved.

Mission usage:
  monolith mission start --title "..." --system "..."
  monolith mission list
  monolith mission show <id>
  monolith mission finish <id> --result completed|failed|cancelled [--summary "..."]
  monolith mission checkpoint <missionId> --summary "..." [--remaining "..." ...] [--context "..."]
  monolith mission checkpoints <missionId>

Brief usage:
  monolith brief [--max-chars N] [--strict]

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
      const parsed = parseInitArgs(args.slice(1));
      if (!parsed.ok) {
        console.error(parsed.message + '\n');
        process.exit(1);
        return;
      }
      const { runInit } = await import('../init/index.js');
      await runInit({ targetDir: process.cwd(), yes: parsed.yes });
      break;
    }

    case 'validate': {
      const { runValidate } = await import('../validate/index.js');
      const quiet = args.includes('--quiet') || args.includes('-q');
      await runValidate({ targetDir: process.cwd(), quiet });
      break;
    }

    case 'mission': {
      const sub = args[1];
      const rest = args.slice(2);
      const {
        runMissionStart,
        runMissionList,
        runMissionShow,
        runMissionFinish,
        runMissionCheckpoint,
        runMissionCheckpoints,
      } = await import('../coordinatorium/cli.js');

      switch (sub) {
        case 'start':
          await runMissionStart(rest);
          break;
        case 'list':
          await runMissionList(rest);
          break;
        case 'show':
          await runMissionShow(rest);
          break;
        case 'finish':
          await runMissionFinish(rest);
          break;
        case 'checkpoint':
          await runMissionCheckpoint(rest);
          break;
        case 'checkpoints':
          await runMissionCheckpoints(rest);
          break;
        default:
          console.error(`Unknown mission subcommand: ${sub ?? '(none)'}\n`);
          console.log(USAGE);
          process.exit(1);
      }
      break;
    }

    case 'brief': {
      const { runBrief } = await import('../brief/cli.js');
      await runBrief(args.slice(1));
      break;
    }

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

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
