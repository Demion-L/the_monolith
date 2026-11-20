#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * MONOLITH CLI entrypoint
 *
 * Commands:
 *   monolith init       — scaffold a new MONOLITH instance from templates/
 *   monolith validate   — static instance checks (never executes project code)
 *   monolith status     — not implemented
 *   monolith dry-run    — not implemented
 *   monolith mission    — manage Tactical Coordinatorium mission lifecycle
 *   monolith brief       — deterministic, bounded project context summary
 *   monolith durable     — inspect/verify/maintain Durable State task logs
 *   monolith idea        — capture and recall deferred ideas (add/list/show)
 *   monolith finalize    — plan/apply a controlled story finalization (documentation sync)
 *   monolith update      — add missing Idea Capture infrastructure to an existing instance
 *   monolith ui          — launch Mission Control (read-only dashboard)
 *   monolith governance  — read-only governance integrity check (governance check)
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
  validate    Static checks of the instance files (config, definition file,
              AGENTS.md, templates). Read-only: writes, creates and deletes
              nothing. Never executes project code. Not a security
              enforcement gate.
  status      Not implemented (exits 1).
  dry-run     Not implemented (exits 1).
  mission     Manage Tactical Coordinatorium missions (start/list/show/finish/checkpoint/checkpoints)
  brief       Print a deterministic, bounded summary of project state (Story,
              active Missions, latest Checkpoints, mandatory Protocols,
              accepted ADRs) — read-only, no LLM/network/ERG involved.
  durable     Inspect and maintain Durable State (long-running task logs):
              list | show | assess | packet | verify | retention.
  idea        Capture a deferred thought without leaving the current task, and
              recall it later: add | list | show. Plain Markdown files, no LLM.
  finalize    Close a story with checked preconditions and controlled documentation
              updates: plan (read-only) | apply --approve <digest>.
  update      Bring an existing instance up to Idea Capture & Recall. Preview by
              default (changes nothing). --apply creates MONOLITH-managed files
              and may add or refresh managed sections inside your existing
              files; your text outside those sections is kept, and conflicting
              edits are never overwritten (see 'monolith update --help').
  governance  Read-only governance integrity check of the governance documents
              (roadmap, story index, capsules, ADRs, ...): governance check
              [--json] [--strict]. Reports problems; changes nothing.
  handover    Read-only autonomous-development handover: handover check [--json] [--strict].
              Restates project state, mission history, ADRs and recorded verification
              evidence with provenance; runs no tests. Not a correctness claim.
  evidence    Record verification evidence: run (executes one command, records its
              exit status as OBSERVED) | report (records a statement as REPORTED) | list.
  hook        Claude Code hook entry points (opt-in): session-start | stop | print-config.
              Read-only; never blocks; 'print-config' only prints a settings snippet.
  ui          Launch Mission Control, the read-only web dashboard, on
              127.0.0.1 (default port 4173). 'ui dev' adds Vite hot reload
              (source checkout only). See 'monolith ui --help'.

Mission usage:
  monolith mission start --title "..." --system "..." [--story <STORY-ID>]
  monolith mission list
  monolith mission show <id>
  monolith mission finish <id> --result completed|failed|cancelled [--summary "..."]
  monolith mission checkpoint <missionId> --summary "..." [--remaining "..." ...] [--context "..."]
  monolith mission checkpoints <missionId>

Brief usage:
  monolith state status
  monolith state adopt <source> [--upgrade-v2] [--apply]   (preview unless --apply)
  monolith brief [--max-chars N] [--strict]
  monolith brief --reconcile [--max-chars N]   (read-only report: what the Freshness verdict rests on)

Durable usage:
  monolith durable list [--status active|completed|failed|cancelled]
  monolith durable show|assess|packet <taskId>
  monolith durable verify [taskId]            (exit 2 if a log fails verification)
  monolith durable retention --retain-days N [--compact-after N] [--apply]

Idea usage:
  monolith idea add --title "..." (--description "..." | --description-stdin) [--context "..."] [--path <project-relative document file> ...]
  monolith idea list
  monolith idea show <id>

Finalize usage:
  monolith finalize plan  --proposal <file|-> [--json]
  monolith finalize apply --proposal <file|-> --approve <digest> [--json]

Update usage:
  monolith update [--apply]

Governance usage:
  monolith governance check [--json] [--strict]   (exit 0 ran, 1 usage, 2 --strict and issues found, 3 could not run)

Handover usage:
  monolith handover check [--json] [--strict]   (exit 0 ran, 1 usage, 2 --strict and not READY FOR REVIEW, 3 could not run)
  monolith evidence run [--story <STORY-ID>] [--timeout-sec N] -- <command> [args...]
  monolith evidence report --command "..." --result pass|fail [--story <STORY-ID>] [--note "..."]
  monolith evidence list [--json]

UI usage:
  monolith ui [--port N]
  monolith ui dev [--port N]

Options:
  --help, -h      Show this help
  --version, -v   Print version
`.trim();
async function main() {
    const args = process.argv.slice(2);
    // `ui` owns its own --help / --version-like flags (`monolith ui dev --help`).
    const ownsHelp = args[0] === 'ui';
    if (args[0] === 'update' && (args.includes('--help') || args.includes('-h'))) {
        const { UPDATE_USAGE } = await import('../update/cli.js');
        console.log(UPDATE_USAGE);
        process.exit(0);
        return;
    }
    if (args.length === 0 || (!ownsHelp && (args.includes('--help') || args.includes('-h')))) {
        console.log(USAGE);
        process.exit(0);
        return;
    }
    if (!ownsHelp && (args.includes('--version') || args.includes('-v'))) {
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
            const { runMissionStart, runMissionList, runMissionShow, runMissionFinish, runMissionCheckpoint, runMissionCheckpoints, } = await import('../coordinatorium/cli.js');
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
        case 'state': {
            const { runState } = await import('../coordinatorium/state-cli.js');
            await runState(args.slice(1));
            break;
        }
        case 'brief': {
            const { runBrief } = await import('../brief/cli.js');
            await runBrief(args.slice(1));
            break;
        }
        case 'durable': {
            const { runDurableCommand } = await import('../durable/cli.js');
            await runDurableCommand(args.slice(1));
            break;
        }
        case 'idea': {
            const { runIdeaCommand } = await import('../ideas/cli.js');
            await runIdeaCommand(args.slice(1));
            break;
        }
        case 'finalize': {
            const { runFinalizeCommand } = await import('../finalize/cli.js');
            process.exitCode = await runFinalizeCommand(args.slice(1));
            break;
        }
        case 'update': {
            const { runUpdate } = await import('../update/cli.js');
            process.exitCode = await runUpdate(args.slice(1));
            break;
        }
        case 'governance': {
            const { runGovernanceCommand } = await import('../governance/cli.js');
            process.exitCode = await runGovernanceCommand(args.slice(1));
            break;
        }
        case 'handover': {
            const { runHandoverCommand } = await import('../handover/cli.js');
            process.exitCode = await runHandoverCommand(args.slice(1));
            break;
        }
        case 'evidence': {
            const { runEvidenceCommand } = await import('../handover/cli.js');
            process.exitCode = await runEvidenceCommand(args.slice(1));
            break;
        }
        case 'hook': {
            const { runHookCommand } = await import('../hooks/index.js');
            process.exitCode = await runHookCommand(args.slice(1));
            break;
        }
        case 'ui': {
            const { runUi } = await import('./ui.js');
            process.exit(await runUi(args.slice(1)));
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
main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
