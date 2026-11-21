/**
 * Project-level execution mode (`monolith.config.json` → `execution`). Explicit opt-in: a project without the key
 * behaves exactly as before ("off").
 *
 *   "execution": { "mode": "managed", "onEnrollmentFailure": "deny" }
 *
 * `mode: "managed"` — a host adapter must enrol implementation work in a Mission before it allows a controlled write.
 * `onEnrollmentFailure` — `deny` (default, strict): a controlled write is refused when enrolment is impossible;
 *                         `allow`: the write proceeds with a visible warning (NOT enforcement).
 * To disable: set `"mode": "off"` (or remove the key), or remove the hook from the host settings.
 */

import { readConfigFile } from '../root/index.js';

export type ExecutionMode = 'off' | 'managed';
export type FailurePolicy = 'deny' | 'allow';

export interface ExecutionConfig {
  mode: ExecutionMode;
  onEnrollmentFailure: FailurePolicy;
  /** `ok`: key valid or absent; `unreadable`: config file unreadable/invalid; `invalid`: key present with unusable values. */
  status: 'ok' | 'unreadable' | 'invalid';
  detail: string | null;
}

export function readExecutionConfig(projectRoot: string): ExecutionConfig {
  const base: ExecutionConfig = { mode: 'off', onEnrollmentFailure: 'deny', status: 'ok', detail: null };
  let read;
  try {
    read = readConfigFile(projectRoot);
  } catch (err) {
    return { ...base, status: 'unreadable', detail: err instanceof Error ? err.message : String(err) };
  }
  if (read.status === 'absent') return base;
  if (read.status !== 'ok') return { ...base, status: 'unreadable', detail: `monolith.config.json is ${read.status}${'detail' in read && read.detail ? `: ${read.detail}` : ''}` };
  const raw = read.cfg.execution;
  if (raw === undefined) return base;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...base, status: 'invalid', detail: '"execution" must be an object' };
  const o = raw as Record<string, unknown>;
  const mode = o.mode ?? 'off';
  const policy = o.onEnrollmentFailure ?? 'deny';
  if (mode !== 'off' && mode !== 'managed') return { ...base, status: 'invalid', detail: `execution.mode must be "off" or "managed", got ${JSON.stringify(mode).slice(0, 40)}` };
  if (policy !== 'deny' && policy !== 'allow') return { ...base, status: 'invalid', detail: `execution.onEnrollmentFailure must be "deny" or "allow", got ${JSON.stringify(policy).slice(0, 40)}` };
  return { mode, onEnrollmentFailure: policy, status: 'ok', detail: null };
}
