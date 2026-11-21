/* eslint-disable no-console */
/**
 * `monolith mission ...` command handlers.
 *
 * Thin layer: parses flags, resolves the instance's state directory, calls
 * into mission.ts, and formats output. All lifecycle/validation logic lives
 * in mission.ts.
 */

import { reportWriteWarning, SafeWriteError } from '../root/index.js';
import { LockCreationError, StateAdoptionRequiredError } from './errors.js';
import type { StateReadTarget, StateWriteTarget } from './state-keeper.js';
import {
  resolveStateLocation,
  stateReadTargetOf,
  stateWriteTargetOf,
  collectStateProvenance,
  formatSplitBrain,
  describeFile,
} from './state-location.js';
import { startMission, listMissions, getMission, finishMission } from './mission.js';
import { enrollMission, handoffMission, currentMissions } from './enrollment.js';
import { deriveExecutionContext, describeOwnership } from './context.js';
import { createCheckpoint, listCheckpoints } from './checkpoint.js';
import type { Mission, MissionResult, Checkpoint } from './types.js';

// One resolver for every command (BETA-020 Phase 2): the shared state in the git
// common directory by default, the project-local file only when isolated or when
// there is no git worktree. Local layouts keep the project-scope containment
// checks (ADR-012); the shared directory is a trusted-directory scope.

/** Split-brain is reported on stderr, never silently: an empty answer must not look like lost history. */
function warnAboutLocalStates(targetDir: string): void {
  const loc = resolveStateLocation(targetDir);
  if (loc.kind !== 'git-common-dir') return;
  const provenance = collectStateProvenance(loc);
  for (const line of formatSplitBrain(provenance)) console.error(line);
}

function readTargetFor(targetDir: string): StateReadTarget {
  warnAboutLocalStates(targetDir);
  return stateReadTargetOf(resolveStateLocation(targetDir));
}

// A write that would start an EMPTY shared state next to worktree-local files
// holding data is refused: to the user it would look like the history was lost.
function writeTargetFor(targetDir: string): StateWriteTarget {
  const loc = resolveStateLocation(targetDir);
  if (loc.kind === 'git-common-dir') {
    const provenance = collectStateProvenance(loc);
    if (provenance.splitBrain.canonicalMissingWithLocalData) {
      throw new StateAdoptionRequiredError(
        [
          ...formatSplitBrain(provenance),
          `Nothing was written. Adopt one of the files above as the shared state first, or set "state": { "mode": "isolated" } in monolith.config.json to keep working per worktree.`,
          `(shared state would be ${loc.statePath}: ${describeFile(provenance.canonical)})`,
        ].join('\n'),
      );
    }
    for (const line of formatSplitBrain(provenance)) console.error(line);
  }
  return stateWriteTargetOf(loc, (w) => reportWriteWarning(w));
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

/** Caller identity for managed-workflow ownership checks: the worktree the command runs in. */
function cliActor(targetDir: string, extra: { sessionId?: string } = {}) {
  return deriveExecutionContext(targetDir, { agent: process.env.MONOLITH_AGENT?.trim() || 'cli', source: 'cli', ...extra });
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
    ...(m.storyId !== undefined ? [`  storyId:    ${m.storyId}`] : []),
    ...(m.owner !== undefined
      ? [`  owner:      ${m.owner.agent} @ ${m.owner.worktree}${m.owner.branch ? ` (${m.owner.branch})` : ''}${m.owner.sessionId ? `, session ${m.owner.sessionId}` : ''}, enrolled via ${m.owner.source}`]
      : []),
  ];
  return lines.join('\n');
}

export async function runMissionStart(args: string[], targetDir = process.cwd()): Promise<void> {
  const title = parseFlag(args, '--title');
  const system = parseFlag(args, '--system');
  const storyId = parseFlag(args, '--story');
  if (!title || !system) {
    throw new Error('Usage: monolith mission start --title "..." --system "..." [--story <STORY-ID>]');
  }
  const mission = await withWriteGuidance(() =>
    startMission(writeTargetFor(targetDir), { title, system, ...(storyId !== undefined ? { storyId } : {}) }),
  );
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

const CHECKPOINT_VALUE_FLAGS: readonly string[] = ['--summary', '--remaining', '--context'];

/** `mission checkpoint` takes only its documented options; an unknown `--option` is an error, not silently dropped. */
function rejectUnknownCheckpointFlags(args: string[]): void {
  for (let i = 1; i < args.length; i++) {
    if (CHECKPOINT_VALUE_FLAGS.includes(args[i])) i++; // its value, whatever it looks like
    else if (args[i].startsWith('--')) {
      throw new Error(
        `Unknown option ${JSON.stringify(args[i].slice(0, 40))} for mission checkpoint.\n` +
          'Usage: monolith mission checkpoint <missionId> --summary "..." [--remaining "..." ...] [--context "..."]',
      );
    }
  }
}

export async function runMissionCheckpoint(args: string[], targetDir = process.cwd()): Promise<void> {
  rejectUnknownCheckpointFlags(args);
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
    }, cliActor(targetDir)),
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
    }, cliActor(targetDir)),
  );
  console.log(`Mission ${mission.id} finished as ${mission.status}`);
  console.log(formatMission(mission));
}

/**
 * `monolith mission enroll [--agent <name>] [--session <id>] [--story <ID>] [--json]`
 * Host-neutral entry to Core enrollment: registers (or reuses) the Mission of THIS worktree for implementation work.
 * Exit status: 0 CREATED/REUSED/SKIPPED, 3 CONFLICT, 4 UNAVAILABLE.
 */
export async function runMissionEnroll(args: string[], targetDir = process.cwd()): Promise<number> {
  const agent = parseFlag(args, '--agent') ?? (process.env.MONOLITH_AGENT?.trim() || 'cli');
  const ctx = deriveExecutionContext(targetDir, {
    agent,
    source: 'cli',
    sessionId: parseFlag(args, '--session'),
    storyId: parseFlag(args, '--story'),
  });
  let result;
  try {
    result = await withWriteGuidance(() => enrollMission(writeTargetFor(targetDir), ctx));
  } catch (err) {
    result = { status: 'UNAVAILABLE' as const, missionId: null, reason: err instanceof Error ? err.message : String(err) };
  }
  if (args.includes('--json')) console.log(JSON.stringify(result));
  else console.log(`${result.status}${result.missionId ? ` ${result.missionId}` : ''}: ${result.reason}${result.candidates ? ` (candidates: ${result.candidates.join(', ')})` : ''}`);
  return result.status === 'CONFLICT' ? 3 : result.status === 'UNAVAILABLE' ? 4 : 0;
}

/** `monolith mission current [--json]` — active Missions owned by this worktree, and active Missions of other contexts with what is known about them. */
export async function runMissionCurrent(args: string[], targetDir = process.cwd()): Promise<void> {
  const ctx = cliActor(targetDir);
  const target = readTargetFor(targetDir);
  const mine = await currentMissions(target, ctx);
  const others = (await listMissions(target)).filter((m) => m.status === 'in_progress' && m.owner !== undefined && m.owner.worktree !== ctx.worktree);
  if (args.includes('--json')) {
    console.log(JSON.stringify({ worktree: ctx.worktree, mine: mine.map((m) => m.id), others: others.map((m) => ({ id: m.id, ...describeOwnership(m, ctx) })) }));
    return;
  }
  console.log(`Worktree: ${ctx.worktree}`);
  console.log(mine.length === 0 ? 'No active mission is owned by this worktree.' : `Active mission(s) of this worktree: ${mine.map((m) => `${m.id} (${m.title})`).join('; ')}`);
  for (const m of others) {
    const v = describeOwnership(m, ctx);
    console.log(`Other context: ${m.id} — ${v.detail}${v.liveness === 'confirmed-orphaned' ? ' [confirmed orphaned: hand it off to continue]' : ''}`);
  }
}

/** `monolith mission handoff <id> --reason "..." [--agent <name>] [--session <id>]` — explicit takeover of an in_progress Mission. */
export async function runMissionHandoff(args: string[], targetDir = process.cwd()): Promise<void> {
  const id = args[0];
  const reason = parseFlag(args, '--reason');
  if (!id || id.startsWith('--') || !reason) throw new Error('Usage: monolith mission handoff <id> --reason "..." [--agent <name>] [--session <id>]');
  const ctx = deriveExecutionContext(targetDir, {
    agent: parseFlag(args, '--agent') ?? (process.env.MONOLITH_AGENT?.trim() || 'cli'),
    source: 'cli:handoff',
    sessionId: parseFlag(args, '--session'),
  });
  const mission = await withWriteGuidance(() => handoffMission(writeTargetFor(targetDir), id, ctx, reason));
  console.log(`Mission ${mission.id} is now owned by this worktree (${ctx.worktree}).`);
  console.log(formatMission(mission));
}
