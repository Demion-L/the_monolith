import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { request } from 'http';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadUiAssets, startDashboardServer, UiAssetsError } from './index.js';
import type { DashboardServer } from './index.js';

let base: string;
let ui: string;
let proj: string;
let server: DashboardServer | null;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'ui-assets-')));
  ui = join(base, 'ui');
  proj = join(base, 'proj');
  mkdirSync(join(ui, 'assets'), { recursive: true });
  mkdirSync(proj);
  writeFileSync(join(ui, 'index.html'), '<!doctype html><title>x</title>');
  writeFileSync(join(ui, 'assets', 'a.js'), 'console.log(1)');
  server = null;
});
afterEach(async () => {
  await server?.close();
  rmSync(base, { recursive: true, force: true });
});

function get(path: string, opts: { method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: server!.port, path, method: opts.method ?? 'GET', headers: opts.headers, agent: false },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('loadUiAssets', () => {
  it('maps files by absolute request path and skips unknown extensions', () => {
    writeFileSync(join(ui, 'notes.txt'), 'nope');
    const a = loadUiAssets(ui);
    expect([...a.keys()].sort()).toEqual(['/assets/a.js', '/index.html']);
    expect(a.get('/assets/a.js')?.contentType).toBe('text/javascript; charset=utf-8');
  });

  it('fails with UI_BUILD_MISSING when the directory or index.html is absent', () => {
    expect(() => loadUiAssets(join(base, 'nope'))).toThrowError(expect.objectContaining({ code: 'UI_BUILD_MISSING' }));
    rmSync(join(ui, 'index.html'));
    expect(() => loadUiAssets(ui)).toThrowError(UiAssetsError);
  });

  it('refuses a symlinked file (never follows it) and so a symlinked index.html is missing', () => {
    writeFileSync(join(base, 'secret.js'), 'SECRET');
    symlinkSync(join(base, 'secret.js'), join(ui, 'assets', 'link.js'));
    expect(loadUiAssets(ui).has('/assets/link.js')).toBe(false);
    rmSync(join(ui, 'index.html'));
    symlinkSync(join(base, 'secret.js'), join(ui, 'index.html'));
    expect(() => loadUiAssets(ui)).toThrowError(expect.objectContaining({ code: 'UI_BUILD_MISSING' }));
  });
});

describe('server with assets', () => {
  it('serves / and asset paths with a CSP and nosniff; unknown paths and traversal are 404', async () => {
    server = await startDashboardServer({ projectRoot: proj, assets: loadUiAssets(ui) });
    const host = { Host: `127.0.0.1:${server.port}` };
    const root = await get('/', { headers: host });
    expect(root.status).toBe(200);
    expect(root.body).toContain('<title>x</title>');
    expect(String(root.headers['content-security-policy'])).toContain("script-src 'self'");
    expect(root.headers['x-content-type-options']).toBe('nosniff');
    expect((await get('/assets/a.js', { headers: host })).status).toBe(200);
    expect((await get('/../secret.js', { headers: host })).status).toBe(404);
    expect((await get('/assets/../index.html', { headers: host })).status).toBe(404);
    expect((await get('/%2e%2e/secret.js', { headers: host })).status).toBe(404);
  });

  it('keeps Host check, GET-only and the API for asset routes', async () => {
    server = await startDashboardServer({ projectRoot: proj, assets: loadUiAssets(ui) });
    expect((await get('/', { headers: { Host: 'evil.example' } })).status).toBe(403);
    expect((await get('/', { method: 'POST', headers: { Host: `127.0.0.1:${server.port}` } })).status).toBe(405);
    expect((await get('/api/dashboard', { headers: { Host: `127.0.0.1:${server.port}` } })).status).toBe(200);
  });

  it('without assets nothing but the API exists', async () => {
    server = await startDashboardServer({ projectRoot: proj });
    expect((await get('/', { headers: { Host: `127.0.0.1:${server.port}` } })).status).toBe(404);
  });
});
