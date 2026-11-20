/**
 * Secure read-only HTTP transport for Mission Control (UI-001B.2, ADR-010 G2).
 *
 * `GET /api/dashboard` serves the existing `DashboardReadModel` exactly as
 * `readDashboardModel(projectRoot)` returns it. `POST /api/diagnostics/validate`
 * and `POST /api/diagnostics/reconcile` (BETA-020 Phase 3) run Core's existing
 * Validation / Reconciliation on demand and return structured DTOs; they take
 * no parameters, need `Content-Type: application/json` with an empty or `{}`
 * body (which a cross-site request cannot send without a CORS preflight, and
 * there is no CORS), and write nothing. No per-launch token is introduced: ADR-010
 * F-8 keeps the token decision for write operations, which do not exist here.
 * This module is a transport only:
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
 * and never reflected; no CORS headers at all; GET (read) and the two diagnostic
 * POSTs only; fixed response
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
export declare const DASHBOARD_PATH = "/api/dashboard";
/**
 * Handover report (ACCOUNTABILITY-001): `GET` only, parameterless, read-only. It is a separate route, not part of the
 * dashboard DTO, because it runs read-only `git` (HEAD / working tree) and so is fetched only when the Handover view
 * is opened or refreshed — never on every dashboard refresh. It runs no test and writes nothing.
 */
export declare const HANDOVER_PATH = "/api/handover";
/**
 * On-demand diagnostics (BETA-020 Phase 3). POST only, because a run is an
 * action, not a read of stored data. They are still read-only for the project:
 * they call Core's `validateProject` and `collect` + `reconcile` in-process
 * (no subprocess, no shell) and write nothing. Not a write API (ADR-010 G2.14).
 */
export declare const VALIDATE_PATH = "/api/diagnostics/validate";
export declare const RECONCILE_PATH = "/api/diagnostics/reconcile";
/** A diagnostics request carries no parameters: an empty body or `{}`. Anything larger is refused unread. */
export declare const MAX_REQUEST_BODY_BYTES = 64;
/** The only bind address; there is deliberately no option to change it. */
export declare const LOOPBACK_HOST = "127.0.0.1";
/**
 * Hard ceiling for one serialized response. The Core read limits (state 16 MiB,
 * active.md 256 KiB, roadmap 1 MiB) are protective ceilings of their own and can exceed
 * it; an over-limit DTO is refused whole, never truncated.
 */
export declare const MAX_RESPONSE_BYTES: number;
/** One file of the built UI, held in memory (loaded by `ui-assets.ts`, which is the only place that touches the disk). */
export interface UiAsset {
    readonly body: Buffer;
    readonly contentType: string;
}
/** Request path (`/index.html`, `/assets/x.js`) -> asset. */
export type UiAssets = ReadonlyMap<string, UiAsset>;
export type HttpErrorKind = 'request' | 'security' | 'dashboard' | 'diagnostics' | 'internal';
export type HttpErrorCode = 'HOST_NOT_ALLOWED' | 'ORIGIN_NOT_ALLOWED' | 'NOT_FOUND' | 'METHOD_NOT_ALLOWED' | 'UNSUPPORTED_MEDIA_TYPE' | 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE' | 'RESPONSE_TOO_LARGE' | 'DIAGNOSTICS_FAILED' | 'INTERNAL_ERROR';
/** Body of every non-200 response. Fixed vocabulary only: no message, path or detail. */
export interface HttpErrorBody {
    error: {
        kind: HttpErrorKind;
        code: HttpErrorCode;
    };
}
export interface DashboardServerOptions {
    /** Absolute project root, chosen by the embedding process. */
    projectRoot: string;
    /** 0 (default) lets the OS pick a free port; read the result from `DashboardServer.port`. */
    port?: number;
    /** Overrides MAX_RESPONSE_BYTES (tests, tighter deployments). */
    maxResponseBytes?: number;
    /**
     * The built UI, already in memory (`loadUiAssets`). When given, `GET /` and
     * `GET <asset path>` serve it; the match is by exact key, so no request path
     * is ever mapped onto the filesystem. When absent, only the API exists.
     */
    assets?: UiAssets;
}
export interface DashboardServer {
    readonly host: typeof LOOPBACK_HOST;
    readonly port: number;
    readonly url: string;
    close(): Promise<void>;
}
export declare function startDashboardServer(options: DashboardServerOptions): Promise<DashboardServer>;
//# sourceMappingURL=server.d.ts.map