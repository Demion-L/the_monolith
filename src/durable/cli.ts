/* eslint-disable no-console */
/**
 * `monolith durable ...` — read-mostly operator commands over the durable store
 * of the current MONOLITH instance (`<monolithRoot>/durable`).
 *
 *   monolith durable list [--status active|completed|failed|cancelled]
 *   monolith durable show <taskId>
 *   monolith durable assess <taskId>
 *   monolith durable packet <taskId>
 *   monolith durable verify [taskId]
 *   monolith durable retention --retain-days N [--compact-after N] [--apply]
 *
 * Output is JSON so it can be piped. Nothing here creates, claims or edits a
 * task: tasks are driven by application code through `DurableTasks`. The only
 * mutating command is `retention --apply`; without `--apply` it only reports.
 */

import { join } from 'path';
import { assertContainedFile, resolveMonolithRoot, reportWriteWarning } from '../root/index.js';
import { DurableError } from './errors.js';
import { FsEventStore } from './fs-store.js';
import { DurableTasks } from './runtime.js';
import type { TaskStatus } from './types.js';

export const DURABLE_DIR_NAME = 'durable';

export interface CliIo {
  cwd: string;
  out: (s: string) => void;
  err: (s: string) => void;
}

const STATUSES: readonly string[] = ['active', 'completed', 'failed', 'cancelled'];

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export function openDurable(cwd: string): DurableTasks {
  const root = resolveMonolithRoot(cwd);
  assertContainedFile(root, `${DURABLE_DIR_NAME}/x`);
  const dir = join(root.rootAbs, DURABLE_DIR_NAME);
  return new DurableTasks({
    store: new FsEventStore({ target: { scope: 'project', projectRoot: root.projectRoot, dir }, onWarning: (w) => reportWriteWarning(w) }),
  });
}

/** Returns the process exit code: 0 ok, 1 usage/error, 2 verification found a problem. */
export async function runDurable(args: string[], io: CliIo): Promise<number> {
  const [sub, ...rest] = args;
  const json = (v: unknown): void => io.out(JSON.stringify(v, null, 2));
  try {
    const rt = openDurable(io.cwd);
    switch (sub) {
      case 'list': {
        const status = flag(rest, '--status');
        if (status !== undefined && !STATUSES.includes(status)) {
          io.err(`--status must be one of ${STATUSES.join(', ')}.`);
          return 1;
        }
        json(await rt.listTasks(status ? { status: status as TaskStatus } : {}));
        return 0;
      }
      case 'show': {
        if (!rest[0]) return usage(io, 'show <taskId>');
        json(await rt.getState(rest[0]));
        return 0;
      }
      case 'assess': {
        if (!rest[0]) return usage(io, 'assess <taskId>');
        json(await rt.assess(rest[0]));
        return 0;
      }
      case 'packet': {
        if (!rest[0]) return usage(io, 'packet <taskId>');
        json(await rt.resumePacket(rest[0]));
        return 0;
      }
      case 'verify': {
        const reports = await rt.verify(rest[0]);
        json(reports);
        return reports.every((r) => r.ok) ? 0 : 2;
      }
      case 'retention': {
        const days = Number(flag(rest, '--retain-days'));
        if (!Number.isFinite(days) || days < 0) return usage(io, 'retention --retain-days N [--compact-after N] [--apply]');
        const compact = flag(rest, '--compact-after');
        const policy = {
          terminalRetentionMs: days * 86_400_000,
          ...(compact !== undefined ? { compactAfterEvents: Number(compact) } : {}),
        };
        if (rest.includes('--apply')) json(await rt.applyRetention(policy));
        else json({ dryRun: true, decisions: await rt.planRetention(policy) });
        return 0;
      }
      default:
        return usage(io, 'list | show <id> | assess <id> | packet <id> | verify [id] | retention --retain-days N [--apply]');
    }
  } catch (err) {
    if (err instanceof DurableError) io.err(`${err.code}: ${err.message}`);
    else io.err(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

function usage(io: CliIo, text: string): number {
  io.err(`Usage: monolith durable ${text}`);
  return 1;
}

export async function runDurableCommand(args: string[]): Promise<void> {
  const code = await runDurable(args, { cwd: process.cwd(), out: (s) => console.log(s), err: (s) => console.error(s) });
  if (code !== 0) process.exit(code);
}
