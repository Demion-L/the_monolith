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
export type ExecutionMode = 'off' | 'managed';
export type FailurePolicy = 'deny' | 'allow';
export interface ExecutionConfig {
    mode: ExecutionMode;
    onEnrollmentFailure: FailurePolicy;
    /** `ok`: key valid or absent; `unreadable`: config file unreadable/invalid; `invalid`: key present with unusable values. */
    status: 'ok' | 'unreadable' | 'invalid';
    detail: string | null;
}
export declare function readExecutionConfig(projectRoot: string): ExecutionConfig;
//# sourceMappingURL=execution-config.d.ts.map