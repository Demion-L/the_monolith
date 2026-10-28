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
 * With `options.assets` it also serves the built UI from memory (`monolith ui`);
 * the API route, the Host/Origin checks and the loopback bind are unchanged.
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
const ERROR_STATUS = {
    HOST_NOT_ALLOWED: 403,
    ORIGIN_NOT_ALLOWED: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    RESPONSE_TOO_LARGE: 500,
    INTERNAL_ERROR: 500,
};
const ERROR_KIND = {
    HOST_NOT_ALLOWED: 'security',
    ORIGIN_NOT_ALLOWED: 'security',
    NOT_FOUND: 'request',
    METHOD_NOT_ALLOWED: 'request',
    RESPONSE_TOO_LARGE: 'dashboard',
    INTERNAL_ERROR: 'internal',
};
function send(res, status, body, extra = {}) {
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
/** CSP of the UI document and its assets: self-hosted code only, no framing, no form posts. */
const UI_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function sendAsset(res, body, contentType) {
    res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': String(body.length),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': UI_CSP,
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin',
    });
    res.end(body);
}
function sendError(res, code) {
    const body = { error: { kind: ERROR_KIND[code], code } };
    // An unread request body must not keep the connection busy.
    const extra = { Connection: 'close' };
    if (code === 'METHOD_NOT_ALLOWED')
        extra.Allow = 'GET';
    send(res, ERROR_STATUS[code], JSON.stringify(body), extra);
}
function single(h) {
    return typeof h === 'string' ? h : undefined;
}
/**
 * Node exposes only the first `Host` in `req.headers`, so duplicates must be
 * counted on the raw header list (names are case-insensitive; values are
 * ignored here and never echoed).
 */
function hostHeaderCount(rawHeaders) {
    let count = 0;
    for (let i = 0; i < rawHeaders.length; i += 2) {
        if (rawHeaders[i].toLowerCase() === 'host')
            count++;
    }
    return count;
}
/** Path of the request target without its query; the query is never interpreted. */
function pathOf(target) {
    if (target === undefined)
        return '';
    const q = target.indexOf('?');
    return q === -1 ? target : target.slice(0, q);
}
export async function startDashboardServer(options) {
    const { projectRoot } = options;
    if (typeof projectRoot !== 'string' || !isAbsolute(projectRoot)) {
        throw new TypeError('projectRoot must be an absolute path');
    }
    const maxBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    let allowedHosts = new Set();
    let allowedOrigins = new Set();
    function handle(req, res) {
        // 1. Security preconditions, before anything about the route is revealed.
        // Exactly one Host: a duplicate is ambiguous (proxies may pick another one).
        const host = single(req.headers.host)?.toLowerCase();
        if (hostHeaderCount(req.rawHeaders) !== 1 || host === undefined || !allowedHosts.has(host))
            return sendError(res, 'HOST_NOT_ALLOWED');
        if (req.headers.origin !== undefined && !allowedOrigins.has(single(req.headers.origin)?.toLowerCase() ?? '')) {
            return sendError(res, 'ORIGIN_NOT_ALLOWED');
        }
        // 2. Route and method. Exact match only: no trailing slash, no decoding.
        const path = pathOf(req.url);
        if (path !== DASHBOARD_PATH) {
            const asset = options.assets?.get(path === '/' ? '/index.html' : path);
            if (asset === undefined)
                return sendError(res, 'NOT_FOUND');
            if (req.method !== 'GET')
                return sendError(res, 'METHOD_NOT_ALLOWED');
            return sendAsset(res, asset.body, asset.contentType);
        }
        if (req.method !== 'GET')
            return sendError(res, 'METHOD_NOT_ALLOWED');
        // 3. The DTO, whole or not at all.
        let body;
        try {
            body = JSON.stringify(readDashboardModel(projectRoot));
        }
        catch {
            return sendError(res, 'INTERNAL_ERROR');
        }
        if (Buffer.byteLength(body, 'utf8') > maxBytes)
            return sendError(res, 'RESPONSE_TOO_LARGE');
        send(res, 200, body);
    }
    const server = createServer((req, res) => {
        try {
            handle(req, res);
        }
        catch {
            if (!res.headersSent)
                sendError(res, 'INTERNAL_ERROR');
            else
                res.destroy();
        }
    });
    server.requestTimeout = 10_000;
    server.headersTimeout = 5_000;
    const port = await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port ?? 0, LOOPBACK_HOST, () => {
            server.off('error', reject);
            const addr = server.address();
            if (addr === null || typeof addr === 'string')
                reject(new Error('unexpected listen address'));
            else
                resolve(addr.port);
        });
    }).catch((err) => {
        server.close();
        throw err;
    });
    allowedHosts = new Set([`${LOOPBACK_HOST}:${port}`, `localhost:${port}`]);
    allowedOrigins = new Set([`http://${LOOPBACK_HOST}:${port}`, `http://localhost:${port}`]);
    return {
        host: LOOPBACK_HOST,
        port,
        url: `http://${LOOPBACK_HOST}:${port}`,
        close: () => new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
            server.closeAllConnections();
        }),
    };
}
