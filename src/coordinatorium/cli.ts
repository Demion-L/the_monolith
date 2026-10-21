/* eslint-disable no-console */
/**
 * `monolith mission ...` command handlers.
 *
 * Thin layer: parses flags, resolves the instance's state directory, calls
 * into mission.ts, and formats output. All lifecycle/validation logic lives
 * in mission.ts.
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { startMission, listMissions, getMission, finishMission } from './mission.js';
import { createCheckpoint, listCheckpoints } from './checkpoint.js';
import type { Mission, MissionResult, Checkpoint } from './types.js';

// Mirrors src/validate/index.ts's readMonolithRoot(). Duplicated rather than
// imported to avoid coupling this subsystem's CLI layer to the validate
// module's internals — both independently default to '.monolith'.
function readMonolithRoot(targetDir: string): string {
  const configPath = join(targetDir, 'monolith.config.json');
  if (!existsSync(configPath)) return '.monolith';
  try {
    const raw = readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    return typeof cfg.monolithRoot === 'string' ? cfg.monolithRoot : '.monolith';
  } catch {
    return '.monolith';
  }
}

function stateDirFor(targetDir: string): string {
  return resolve(targetDir, readMonolithRoot(targetDir));
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
  const mission = await startMission(stateDirFor(targetDir), { title, system });
  console.log(`Started mission ${mission.id} (${mission.status})`);
  console.log(formatMission(mission));
}

export async function runMissionList(_args: string[], targetDir = process.cwd()): Promise<void> {
  const missions = await listMissions(stateDirFor(targetDir));
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
  const mission = await getMission(stateDirFor(targetDir), id);
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
  const checkpoint = await createCheckpoint(stateDirFor(targetDir), missionId, {
    summary,
    remainingSteps,
    context: context ?? null,
  });
  console.log(`Created checkpoint ${checkpoint.id} for mission ${checkpoint.missionId}`);
  console.log(formatCheckpoint(checkpoint));
}

export async function runMissionCheckpoints(args: string[], targetDir = process.cwd()): Promise<void> {
  const missionId = args[0];
  if (!missionId) {
    throw new Error('Usage: monolith mission checkpoints <missionId>');
  }
  const checkpoints = await listCheckpoints(stateDirFor(targetDir), missionId);
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
  const mission = await finishMission(stateDirFor(targetDir), id, {
    result: result as MissionResult,
    summary: summary ?? undefined,
  });
  console.log(`Mission ${mission.id} finished as ${mission.status}`);
  console.log(formatMission(mission));
}
