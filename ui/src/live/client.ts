import type { DashboardReadModel } from '../../../src/readmodel/types';
import { isDashboardReadModel } from './validate';

/**
 * The only endpoint the UI talks to. Fixed on purpose: no user-supplied URL,
 * and no project root is ever sent (the server fixes it at startup, ADR-010 G2).
 */
export const DASHBOARD_ENDPOINT = '/api/dashboard';

export type DashboardLoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: DashboardReadModel }
  | { status: 'error'; message: string };

/** Fixed error vocabulary of the HTTP layer; anything else is not echoed. */
const KNOWN_SERVER_CODES = [
  'HOST_NOT_ALLOWED',
  'ORIGIN_NOT_ALLOWED',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'RESPONSE_TOO_LARGE',
  'INTERNAL_ERROR',
];

/** A failed load. `message` is composed here from fixed text, never from response content. */
export class DashboardLoadError extends Error {}

async function serverCode(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json();
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    return typeof code === 'string' && KNOWN_SERVER_CODES.includes(code) ? code : null;
  } catch {
    return null;
  }
}

/**
 * Loads the dashboard DTO. Resolves only with a structurally valid
 * `DashboardReadModel`; every other outcome throws `DashboardLoadError`.
 * `fetchImpl` exists for tests; the URL is not a parameter.
 */
export async function fetchDashboard(fetchImpl: typeof fetch = fetch): Promise<DashboardReadModel> {
  let res: Response;
  try {
    res = await fetchImpl(DASHBOARD_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
  } catch {
    throw new DashboardLoadError('The MONOLITH API is unreachable.');
  }
  if (!res.ok) {
    const code = await serverCode(res);
    throw new DashboardLoadError(
      `Dashboard request failed (HTTP ${res.status}${code ? `, ${code}` : ''}). Check whether the MONOLITH dev API is running.`,
    );
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new DashboardLoadError('The MONOLITH API returned a response that is not valid JSON.');
  }
  if (!isDashboardReadModel(body)) {
    throw new DashboardLoadError('The MONOLITH API returned an unexpected data shape.');
  }
  return body;
}
