/* eslint-disable no-console */
/**
 * `monolith durable ...` — read-mostly operator commands over the durable store
 * of the current MONOLITH instance (`<monolithRoot>/durable`).
 *
 *   monolith durable list [--status active|completed|failed|cancelled]
 *   monolith durable show <taskId> [--reveal-tokens]
 *   monolith durable assess <taskId>
 *   monolith durable packet <taskId> [--reveal-tokens]
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

/**
 * Await tokens are capabilities: whoever holds one can deliver a result to the task. The CLI output ends up in
 * terminals, logs and tickets, so the secret part (the nonce) is replaced there; `--reveal-tokens` prints it.
 * The programmatic API (`getState`, `resumePacket`) is unchanged: a worker needs the real token to send it out.
 */
function redactTokens(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactTokens);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      out[k] = k === 'token' && typeof x === 'string' ? x.replace(/\.[0-9a-f]{32}$/, '.<redacted>') : redactTokens(x);
    }
    return out;
  }
  return v;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function openStore(cwd: string): FsEventStore {
  const root = resolveMonolithRoot(cwd);
  assertContainedFile(root, `${DURABLE_DIR_NAME}/x`);
  const dir = join(root.rootAbs, DURABLE_DIR_NAME);
  return new FsEventStore({ target: { scope: 'project', projectRoot: root.projectRoot, dir }, onWarning: (w) => reportWriteWarning(w) });
}

/**
 * Opens the durable store of the instance. A store without `durable-protocol.json` is open for diagnostics only: reads
 * work, every write is refused (`STORE_PROTOCOL`). Opening never creates the marker.
 */
export function openDurable(cwd: string): DurableTasks {
  return new DurableTasks({ store: openStore(cwd) });
}

/**
 * The explicit operator action that makes an EMPTY store writable (Design A section 46.5, ADR-018 D3). Not reachable from
 * `runDurable` on purpose: it must be called by a person or script that knows no runtime of an older version is running.
 * Refuses a store that already holds tasks.
 */
export function initializeDurable(cwd: string): 'initialized' | 'already-initialized' {
  return openStore(cwd).initializeProtocolSync();
}

/** Returns the process exit code: 0 ok, 1 usage/error, 2 verification found a problem. */
export async function runDurable(args: string[], io: CliIo): Promise<number> {
  const [sub, ...rest] = args;
  const reveal = rest.includes('--reveal-tokens');
  const json = (v: unknown): void => io.out(JSON.stringify(reveal ? v : redactTokens(v), null, 2));
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
