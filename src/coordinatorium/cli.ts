/* eslint-disable no-console */
/**
 * `monolith mission ...` command handlers.
 *
 * Thin layer: parses flags, resolves the instance's state directory, calls
 * into mission.ts, and formats output. All lifecycle/validation logic lives
 * in mission.ts.
 */

import { resolveMonolithRoot, assertContainedFile, reportWriteWarning, SafeWriteError } from '../root/index.js';
import { LockCreationError } from './errors.js';
import { STATE_FILE_NAME, projectTarget, type StateReadTarget, type StateWriteTarget } from './state-keeper.js';
import { startMission, listMissions, getMission, finishMission } from './mission.js';
import { createCheckpoint, listCheckpoints } from './checkpoint.js';
import type { Mission, MissionResult, Checkpoint } from './types.js';

// Reads use the same PROJECT scope as writes (SEC-001B.1-R): the project root is
// the explicit boundary, so a symlink anywhere below it is refused.
function readTargetFor(targetDir: string): StateReadTarget {
  const root = resolveMonolithRoot(targetDir);
  assertContainedFile(root, STATE_FILE_NAME);
  return projectTarget(root.projectRoot, root.rootAbs);
}

// Writes always use PROJECT scope (ADR-012): the project root is the boundary,
// so a symlinked `monolithRoot` or intermediate directory is refused even when
// it stays inside the project.
function writeTargetFor(targetDir: string): StateWriteTarget {
  const root = resolveMonolithRoot(targetDir);
  assertContainedFile(root, STATE_FILE_NAME);
  assertContainedFile(root, `${STATE_FILE_NAME}.lock`);
  return projectTarget(root.projectRoot, root.rootAbs, (w) => reportWriteWarning(w));
}

/**
 * A write whose outcome is UNKNOWN (SEC-001B.2) was NOT retried and nothing was
 * cleaned up. The wrapper keeps the machine-readable fields of the original
 * error (`code`, `publication`, `phase`, `path`) and the error itself as
 * `cause`; only the message gains guidance, which depends on WHAT is unknown:
 *
 *  - `state`: `state.json` may or may not have been replaced. Look at the
 *    missions before repeating a command that is not idempotent (a second
 *    `start` would register a second mission).
 *  - `lock`: it is the creation of the lock file that is unknown; no state was
 *    written. The mission list says nothing about it — inspect the lock and its
 *    staging files, and remove nothing while another command may be running.
 */
export class UnknownWriteOutcomeError extends Error {
  readonly code: string;
  readonly publication = 'UNKNOWN' as const;
  readonly phase: string;
  readonly path: string;
  readonly subject: 'state' | 'lock';
  readonly cause: unknown;

  constructor(original: SafeWriteError | LockCreationError) {
    const lock = original instanceof LockCreationError;
    const guidance = lock
      ? `The outcome of creating the lock is UNKNOWN. It was not retried and nothing was removed; no state was written. ` +
        `Inspect, read-only, "${original.lockPath}" and any "${original.lockPath}.creating.*" or "${original.lockPath}.recovery" ` +
        'next to it. MONOLITH never deletes these automatically (FS-CLEAN-001); remove nothing while another monolith ' +
        'command may be running.'
      : 'The outcome of this write is UNKNOWN. It was not retried. Check the current state with ' +
        '`monolith mission list` (and `monolith mission show <id>`) before running this command again.';
    super(`${original.message}\n${guidance}`);
    this.name = 'UnknownWriteOutcomeError';
    this.code = original.code;
    this.phase = original.phase;
    this.path = lock ? original.lockPath : original.path;
    this.subject = lock ? 'lock' : 'state';
    this.cause = original;
  }
}

export async function withWriteGuidance<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if ((err instanceof SafeWriteError || err instanceof LockCreationError) && err.publication === 'UNKNOWN') {
      throw new UnknownWriteOutcomeError(err);
    }
    throw err;
  }
}

function parseFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1 || i === args.length - 1) return undefined;
  return args[i + 1];
}

/** Like parseFlag, but collects every occurrence (e.g. repeated `--remaining`). */
function parseRepeatedFlag(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === name) values.push(args[i + 1]);
  }
  return values;
}

function formatMission(m: Mission): string {
  const lines = [
    `  id:         ${m.id}`,
    `  title:      ${m.title}`,
    `  system:     ${m.system}`,
    `  status:     ${m.status}`,
    `  startedAt:  ${m.startedAt}`,
    `  updatedAt:  ${m.updatedAt}`,
    `  summary:    ${m.summary ?? '(none)'}`,
  ];
  return lines.join('\n');
}

export async function runMissionStart(args: string[], targetDir = process.cwd()): Promise<void> {
  const title = parseFlag(args, '--title');
  const system = parseFlag(args, '--system');
  if (!title || !system) {
    throw new Error('Usage: monolith mission start --title "..." --system "..."');
  }
  const mission = await withWriteGuidance(() => startMission(writeTargetFor(targetDir), { title, system }));
  console.log(`Started mission ${mission.id} (${mission.status})`);
  console.log(formatMission(mission));
}

export async function runMissionList(_args: string[], targetDir = process.cwd()): Promise<void> {
  const missions = await listMissions(readTargetFor(targetDir));
  if (missions.length === 0) {
    console.log('No missions.');
    return;
  }

  const active = missions.filter((m) => m.status === 'in_progress');
  const finished = missions.filter((m) => m.status !== 'in_progress');

  console.log(`Active missions (${active.length}):`);
  if (active.length === 0) console.log('  (none)');
  for (const m of active) {
    console.log(`  ${m.id}  [${m.status}]  ${m.title} (${m.system})`);
  }

  console.log('');
  console.log(`Finished missions (${finished.length}):`);
  if (finished.length === 0) console.log('  (none)');
  for (const m of finished) {
    console.log(`  ${m.id}  [${m.status}]  ${m.title} (${m.system})`);
  }
}

export async function runMissionShow(args: string[], targetDir = process.cwd()): Promise<void> {
  const id = args[0];
  if (!id) {
    throw new Error('Usage: monolith mission show <id>');
  }
  const mission = await getMission(readTargetFor(targetDir), id);
  console.log(formatMission(mission));
}

function formatCheckpoint(c: Checkpoint): string {
  const lines = [
    `  id:              ${c.id}`,
    `  missionId:       ${c.missionId}`,
    `  createdAt:       ${c.createdAt}`,
    `  summary:         ${c.summary}`,
    `  remainingSteps:  ${c.remainingSteps.length === 0 ? '(none)' : ''}`,
    ...c.remainingSteps.map((s) => `    - ${s}`),
    `  context:         ${c.context ?? '(none)'}`,
  ];
  return lines.join('\n');
}

export async function runMissionCheckpoint(args: string[], targetDir = process.cwd()): Promise<void> {
  const missionId = args[0];
  const summary = parseFlag(args, '--summary');
  if (!missionId || !summary) {
    throw new Error(
      'Usage: monolith mission checkpoint <missionId> --summary "..." [--remaining "..." ...] [--context "..."]',
    );
  }
  const remainingSteps = parseRepeatedFlag(args, '--remaining');
  const context = parseFlag(args, '--context');
  const checkpoint = await withWriteGuidance(() =>
    createCheckpoint(writeTargetFor(targetDir), missionId, {
      summary,
      remainingSteps,
      context: context ?? null,
    }),
  );
  console.log(`Created checkpoint ${checkpoint.id} for mission ${checkpoint.missionId}`);
  console.log(formatCheckpoint(checkpoint));
}

export async function runMissionCheckpoints(args: string[], targetDir = process.cwd()): Promise<void> {
  const missionId = args[0];
  if (!missionId) {
    throw new Error('Usage: monolith mission checkpoints <missionId>');
  }
  const checkpoints = await listCheckpoints(readTargetFor(targetDir), missionId);
  if (checkpoints.length === 0) {
    console.log(`No checkpoints for mission ${missionId}.`);
    return;
  }
  console.log(`Checkpoints for mission ${missionId} (${checkpoints.length}):`);
  for (const c of checkpoints) {
    console.log('');
    console.log(formatCheckpoint(c));
  }
}

export async function runMissionFinish(args: string[], targetDir = process.cwd()): Promise<void> {
  const id = args[0];
  const result = parseFlag(args, '--result');
  const summary = parseFlag(args, '--summary');
  if (!id || !result) {
    throw new Error('Usage: monolith mission finish <id> --result completed|failed|cancelled [--summary "..."]');
  }
  const mission = await withWriteGuidance(() =>
    finishMission(writeTargetFor(targetDir), id, {
      result: result as MissionResult,
      summary: summary ?? undefined,
    }),
  );
  console.log(`Mission ${mission.id} finished as ${mission.status}`);
  console.log(formatMission(mission));
}
