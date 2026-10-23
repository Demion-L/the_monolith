/**
 * Secure read-only HTTP transport for Mission Control (UI-001B.2, ADR-010 G2).
 *
 * One endpoint, `GET /api/dashboard`, serves the existing `DashboardReadModel`
 * exactly as `readDashboardModel(projectRoot)` returns it. This module is a
 * transport only:
 *  - it reads no file and imports no filesystem module; every byte of project
 *    data arrives through `readDashboardModel` (ADR-014 safe read);
 *  - it knows nothing about `state.json`, its schema or its physical layout, so
 *    the Core storage can change (STATE-003) without touching this layer;
 *  - the project root is fixed when the server starts and is never taken from a
 *    request (query, body, header or cookie are not read for that purpose).
 *
 * Security boundary (G2): bound to 127.0.0.1 only; `Host` allowlist (loopback
 * name + the real port, against DNS rebinding); `Origin` checked when present
 * and never reflected; no CORS headers at all; GET only; fixed response
 * headers; bounded response size with no partial JSON; errors are fixed codes,
 * never exception text or paths. Loopback is NOT treated as authentication.
 *
 * Source failures (absent / forbidden / corrupt / unreadable) are part of the
 * DTO (`SourceReport`) and keep their Typed Read Model semantics: they are a
 * valid 200 response carrying `data: null` and a typed code, never project
 * content. Threat model (ADR-013): TM-A supported with limitations, TM-B
 * partially supported, TM-C (concurrent adversarial mutation) NOT supported;
 * dynamic TOCTOU is not closed here, nor by Core.
 */

import { createServer } from 'http';
import type { IncomingMessage, Server, ServerResponse } from 'http';
import { isAbsolute } from 'path';
import { readDashboardModel } from '../readmodel/index.js';

export const DASHBOARD_PATH = '/api/dashboard';
/** The only bind address; there is deliberately no option to change it. */
export const LOOPBACK_HOST = '127.0.0.1';
/**
 * Hard ceiling for one serialized response. The Core read limits (state 16 MiB,
 * active.md/roadmap 256 KiB) are protective ceilings of their own and can exceed
 * it; an over-limit DTO is refused whole, never truncated.
 */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type HttpErrorKind = 'request' | 'security' | 'dashboard' | 'internal';
export type HttpErrorCode =
  | 'HOST_NOT_ALLOWED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'RESPONSE_TOO_LARGE'
  | 'INTERNAL_ERROR';

/** Body of every non-200 response. Fixed vocabulary only: no message, path or detail. */
export interface HttpErrorBody {
  error: { kind: HttpErrorKind; code: HttpErrorCode };
}

export interface DashboardServerOptions {
  /** Absolute project root, chosen by the embedding process. */
  projectRoot: string;
  /** 0 (default) lets the OS pick a free port; read the result from `DashboardServer.port`. */
  port?: number;
  /** Overrides MAX_RESPONSE_BYTES (tests, tighter deployments). */
  maxResponseBytes?: number;
}

export interface DashboardServer {
  readonly host: typeof LOOPBACK_HOST;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

const ERROR_STATUS: Readonly<Record<HttpErrorCode, number>> = {
  HOST_NOT_ALLOWED: 403,
  ORIGIN_NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  RESPONSE_TOO_LARGE: 500,
  INTERNAL_ERROR: 500,
};

const ERROR_KIND: Readonly<Record<HttpErrorCode, HttpErrorKind>> = {
  HOST_NOT_ALLOWED: 'security',
  ORIGIN_NOT_ALLOWED: 'security',
  NOT_FOUND: 'request',
  METHOD_NOT_ALLOWED: 'request',
  RESPONSE_TOO_LARGE: 'dashboard',
  INTERNAL_ERROR: 'internal',
};

function send(res: ServerResponse, status: number, body: string, extra: Record<string, string> = {}): void {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(buf.length),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'",
    ...extra,
  });
  res.end(buf);
}

function sendError(res: ServerResponse, code: HttpErrorCode): void {
  const body: HttpErrorBody = { error: { kind: ERROR_KIND[code], code } };
  // An unread request body must not keep the connection busy.
  const extra: Record<string, string> = { Connection: 'close' };
  if (code === 'METHOD_NOT_ALLOWED') extra.Allow = 'GET';
  send(res, ERROR_STATUS[code], JSON.stringify(body), extra);
}

function single(h: string | string[] | undefined): string | undefined {
  return typeof h === 'string' ? h : undefined;
}

/** Path of the request target without its query; the query is never interpreted. */
function pathOf(target: string | undefined): string {
  if (target === undefined) return '';
  const q = target.indexOf('?');
  return q === -1 ? target : target.slice(0, q);
}

export async function startDashboardServer(options: DashboardServerOptions): Promise<DashboardServer> {
  const { projectRoot } = options;
  if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot)) {
    throw new TypeError('projectRoot must be an absolute path');
  }
  const maxBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  let allowedHosts: ReadonlySet<string> = new Set();
  let allowedOrigins: ReadonlySet<string> = new Set();

  function handle(req: IncomingMessage, res: ServerResponse): void {
    // 1. Security preconditions, before anything about the route is revealed.
    const host = single(req.headers.host)?.toLowerCase();
    if (host === undefined || !allowedHosts.has(host)) return sendError(res, 'HOST_NOT_ALLOWED');
    if (req.headers.origin !== undefined && !allowedOrigins.has(single(req.headers.origin)?.toLowerCase() ?? '')) {
      return sendError(res, 'ORIGIN_NOT_ALLOWED');
    }

    // 2. Route and method. Exact match only: no trailing slash, no decoding.
    if (pathOf(req.url) !== DASHBOARD_PATH) return sendError(res, 'NOT_FOUND');
    if (req.method !== 'GET') return sendError(res, 'METHOD_NOT_ALLOWED');

    // 3. The DTO, whole or not at all.
    let body: string;
    try {
      body = JSON.stringify(readDashboardModel(projectRoot));
    } catch {
      return sendError(res, 'INTERNAL_ERROR');
    }
    if (Buffer.byteLength(body, 'utf8') > maxBytes) return sendError(res, 'RESPONSE_TOO_LARGE');
    send(res, 200, body);
  }

  const server: Server = createServer((req, res) => {
    try {
      handle(req, res);
    } catch {
      if (!res.headersSent) sendError(res, 'INTERNAL_ERROR');
      else res.destroy();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, LOOPBACK_HOST, () => {
      server.off('error', reject);
      const addr = server.address();
      if (addr === null || typeof addr === 'string') reject(new Error('unexpected listen address'));
      else resolve(addr.port);
    });
  }).catch((err: unknown) => {
    server.close();
    throw err;
  });

  allowedHosts = new Set([`${LOOPBACK_HOST}:${port}`, `localhost:${port}`]);
  allowedOrigins = new Set([`http://${LOOPBACK_HOST}:${port}`, `http://localhost:${port}`]);

  return {
    host: LOOPBACK_HOST,
    port,
    url: `http://${LOOPBACK_HOST}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
