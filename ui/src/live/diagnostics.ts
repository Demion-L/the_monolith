import { shallowRef } from 'vue';
import type { ReconciliationResultDto, ValidationResultDto } from '../../../src/readmodel/diagnostics-types';

/**
 * On-demand diagnostics (BETA-020 Phase 3). The UI asks the local MONOLITH API to
 * run Core's existing Validation / Reconciliation and only displays the result.
 * The endpoints are fixed: no user-supplied URL, no project root, no parameters.
 */
export const VALIDATE_ENDPOINT = '/api/diagnostics/validate';
export const RECONCILE_ENDPOINT = '/api/diagnostics/reconcile';

export type DiagnosticKind = 'validation' | 'reconciliation';

/** A failed run. `message` is composed here from fixed text, never from response content. */
export class DiagnosticsError extends Error {}

const SERVER_MESSAGES: Record<string, string> = {
  HOST_NOT_ALLOWED: 'The request was refused: this page is not served from the local MONOLITH address.',
  ORIGIN_NOT_ALLOWED: 'The request was refused: it did not come from the Mission Control page itself.',
  NOT_FOUND: 'This MONOLITH server does not offer this diagnostic. Update MONOLITH, or restart Mission Control.',
  METHOD_NOT_ALLOWED: 'The server did not accept the request method.',
  UNSUPPORTED_MEDIA_TYPE: 'The server did not accept the request format.',
  BAD_REQUEST: 'The server did not accept the request.',
  PAYLOAD_TOO_LARGE: 'The server did not accept the request.',
  RESPONSE_TOO_LARGE: 'The result was too large to be shown.',
  DIAGNOSTICS_FAILED: 'The check could not be completed. The project files may be unreadable. Try again or run it in a terminal.',
  INTERNAL_ERROR: 'The MONOLITH server failed while running the check.',
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isArrOf = (v: unknown, f: (x: unknown) => boolean): boolean => Array.isArray(v) && v.every(f);

const CHECK_IDS = ['configuration', 'instance', 'templates'];

export function isValidationResult(v: unknown): v is ValidationResultDto {
  return (
    isObj(v) &&
    (v.result === 'PASS' || v.result === 'FAIL') &&
    isStrOrNull(v.warning) &&
    isArrOf(v.checks, (c) => isObj(c) && isStr(c.id) && CHECK_IDS.includes(c.id) && isStr(c.label) && typeof c.passed === 'boolean' && isStrOrNull(c.message) && isStrOrNull(c.note)) &&
    // The overall result is derived from the checks, never trusted on its own.
    (v.result === 'PASS') === (v.checks as { passed: boolean }[]).every((c) => c.passed) &&
    (v.checks as unknown[]).length > 0
  );
}

const note = (n: unknown): boolean => isObj(n) && isStr(n.code) && isStr(n.summary) && isStrArr(n.evidence);

export function isReconciliationResult(v: unknown): v is ReconciliationResultDto {
  return (
    isObj(v) &&
    (v.evidence === 'COMPLETE' || v.evidence === 'INCOMPLETE' || v.evidence === 'UNKNOWN') &&
    (v.freshness === 'FRESH' || v.freshness === 'STALE' || v.freshness === 'UNKNOWN') &&
    (v.lastStateUpdate === null || (isObj(v.lastStateUpdate) && isStr(v.lastStateUpdate.sha) && isStr(v.lastStateUpdate.date))) &&
    isArrOf(v.conflicts, (c) => isObj(c) && isStr(c.summary) && isArrOf(c.sources, (s) => isObj(s) && isStr(s.document) && isStr(s.claim))) &&
    isArrOf(v.unrecordedWork, (u) => isObj(u) && isStr(u.id) && typeof u.totalCommits === 'number' && isArrOf(u.commits, (c) => isObj(c) && isStr(c.sha) && isStr(c.subject))) &&
    isArrOf(v.unattributed, note) &&
    isArrOf(v.evidenceIssues, note) &&
    isArrOf(v.documents, (d) => isObj(d) && isStr(d.path) && isStrArr(d.reasons)) &&
    isStrArr(v.actions) &&
    isStrArr(v.limitations) &&
    typeof v.truncated === 'boolean'
  );
}

async function serverCode(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    const code = isObj(body) && isObj(body.error) ? body.error.code : undefined;
    return isStr(code) && code in SERVER_MESSAGES ? code : null;
  } catch {
    return null;
  }
}

async function post<T>(endpoint: string, guard: (v: unknown) => v is T, fetchImpl: typeof fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
  } catch {
    throw new DiagnosticsError('The MONOLITH API is unreachable. Check that Mission Control is still running.');
  }
  if (!res.ok) {
    const code = await serverCode(res);
    throw new DiagnosticsError(code === null ? `The check failed (HTTP ${res.status}).` : SERVER_MESSAGES[code]);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new DiagnosticsError('The MONOLITH API returned a response that is not valid JSON.');
  }
  if (!guard(body)) throw new DiagnosticsError('The MONOLITH API returned an unexpected data shape.');
  return body;
}

export const runValidationRequest = (fetchImpl: typeof fetch = fetch): Promise<ValidationResultDto> =>
  post(VALIDATE_ENDPOINT, isValidationResult, fetchImpl);
export const runReconciliationRequest = (fetchImpl: typeof fetch = fetch): Promise<ReconciliationResultDto> =>
  post(RECONCILE_ENDPOINT, isReconciliationResult, fetchImpl);

/** `idle` = NOT RUN in this UI session. A result exists only after a completed run. */
export type RunState<T> =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: T; at: Date }
  | { status: 'error'; message: string; at: Date };

export interface DiagnosticRunner<T> {
  readonly state: RunState<T>;
  run(): Promise<void>;
}

/**
 * One runner per diagnostic. While a run is in progress `run()` does nothing, so
 * repeated clicks never start parallel identical requests. The previous result
 * is dropped when a new run starts: nothing stale (or PASS) is shown while RUNNING.
 */
export function createRunner<T>(request: () => Promise<T>): DiagnosticRunner<T> {
  const state = shallowRef<RunState<T>>({ status: 'idle' });
  return {
    get state(): RunState<T> {
      return state.value;
    },
    async run(): Promise<void> {
      if (state.value.status === 'running') return;
      state.value = { status: 'running' };
      try {
        state.value = { status: 'done', result: await request(), at: new Date() };
      } catch (e) {
        const message = e instanceof DiagnosticsError ? e.message : 'The check could not be completed.';
        state.value = { status: 'error', message, at: new Date() };
      }
    },
  };
}

export interface DiagnosticRunners {
  validation: DiagnosticRunner<ValidationResultDto>;
  reconciliation: DiagnosticRunner<ReconciliationResultDto>;
}

export function createRunners(): DiagnosticRunners {
  return {
    validation: createRunner(() => runValidationRequest()),
    reconciliation: createRunner(() => runReconciliationRequest()),
  };
}
