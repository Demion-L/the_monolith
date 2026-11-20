import type { HandoverReport } from '../../../src/handover/types';

/** Fixed, parameterless endpoint (read-only GET). The project root is never sent. */
export const HANDOVER_ENDPOINT = '/api/handover';

export type HandoverLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: HandoverReport }
  | { status: 'error'; message: string };

const STATUSES = ['READY_FOR_REVIEW', 'REVIEW_WITH_ISSUES', 'INCOMPLETE', 'UNKNOWN'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural check of the fields the view reads. Anything else is refused, never half-rendered. */
export function isHandoverReport(v: unknown): v is HandoverReport {
  if (!isObj(v) || v.schema !== 1 || typeof v.status !== 'string' || !STATUSES.includes(v.status)) return false;
  if (!Array.isArray(v.statusReasons) || !Array.isArray(v.limitations) || !Array.isArray(v.sources)) return false;
  for (const k of ['project', 'progress', 'missions', 'architecture', 'verification', 'outstanding']) if (!isObj(v[k])) return false;
  const progress = v.progress as Record<string, unknown>;
  const verification = v.verification as Record<string, unknown>;
  const outstanding = v.outstanding as Record<string, unknown>;
  return (
    Array.isArray(progress.stories) &&
    Array.isArray(verification.items) &&
    isObj(verification.counts) &&
    isObj(verification.git) &&
    Array.isArray(outstanding.issues) &&
    Array.isArray(outstanding.ownerDecisions)
  );
}

export async function fetchHandover(fetchImpl: typeof fetch = fetch): Promise<HandoverReport> {
  let res: Response;
  try {
    res = await fetchImpl(HANDOVER_ENDPOINT, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'omit', redirect: 'error' });
  } catch {
    throw new Error('The MONOLITH API is unreachable.');
  }
  if (!res.ok) throw new Error(`Handover request failed (HTTP ${res.status}).`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error('The MONOLITH API returned a response that is not valid JSON.');
  }
  if (!isHandoverReport(body)) throw new Error('The MONOLITH API returned an unexpected data shape.');
  return body;
}
