import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request, Server } from 'http';
import { createConnection } from 'net';
import {
  linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'fs';
import { networkInterfaces, tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { startDashboardServer, MAX_RESPONSE_BYTES } from './index.js';
import type { DashboardServer } from './index.js';
import { readDashboardModel, ROADMAP_REL } from '../readmodel/index.js';
import type { DashboardReadModel } from '../readmodel/index.js';

// Pass-through spy so tests can prove a rejected request never reaches the read model.
vi.mock('../readmodel/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../readmodel/index.js')>();
  return { ...actual, readDashboardModel: vi.fn(actual.readDashboardModel) };
});

let dir: string;
let outside: string;
let server: DashboardServer | null;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'http-proj-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'http-out-')));
  server = null;
});
afterEach(async () => {
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function write(rel: string, content: string, base = dir): void {
  const abs = join(base, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function stateJson(): string {
  const m = { id: 'MIS-0001', title: 'T', system: 'sys', status: 'in_progress', startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', summary: null };
  const c = { id: 'MIS-0001-CKPT-0001', missionId: 'MIS-0001', createdAt: '2026-01-02T00:00:00.000Z', summary: 's', remainingSteps: ['r'], context: null };
  return JSON.stringify({
    schemaVersion: 2, revision: 3, strategic: { systems: {} },
    tactical: { missions: { [m.id]: m }, checkpoints: { [c.id]: c } },
  });
}
function fullProject(base = dir, name = 'Demo'): void {
  write('monolith.config.json', JSON.stringify({ project: { name } }), base);
  write('.monolith/state.json', stateJson(), base);
  write('.monolith/memory/working/active.md', '# Active\n\n## Current Story\n\nStory.\n', base);
  write(`.monolith/${ROADMAP_REL}`, '# Roadmap\n', base);
}

interface Res { status: number; headers: Record<string, string | string[] | undefined>; body: string }
function http(s: DashboardServer, opts: { method?: string; path?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: s.port, method: opts.method ?? 'GET', path: opts.path ?? '/api/dashboard', headers: opts.headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end(opts.method && opts.method !== 'GET' ? '{}' : undefined);
  });
}
async function start(maxResponseBytes?: number): Promise<DashboardServer> {
  server = await startDashboardServer({ projectRoot: dir, maxResponseBytes });
  return server;
}
const dto = (r: Res) => JSON.parse(r.body) as DashboardReadModel;
const noAccessControl = (r: Res) =>
  Object.keys(r.headers).filter((h) => h.startsWith('access-control-'));

describe('functional', () => {
  it('GET /api/dashboard returns exactly the Typed Read Model', async () => {
    fullProject();
    const s = await start();
    const r = await http(s);
    expect(r.status).toBe(200);
    expect(dto(r)).toEqual(readDashboardModel(dir));
    expect(dto(r).projectOverview.data?.name).toBe('Demo');
  });

  it('sends the required headers and Content-Type', async () => {
    fullProject();
    const r = await http(await start());
    expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['content-security-policy']).toBe("default-src 'none'");
  });

  it('serves repeated requests and re-reads the project each time', async () => {
    fullProject();
    const s = await start();
    expect(dto(await http(s)).projectOverview.data?.name).toBe('Demo');
    write('monolith.config.json', JSON.stringify({ project: { name: 'Renamed' } }));
    expect(dto(await http(s)).projectOverview.data?.name).toBe('Renamed');
    expect((await http(s)).status).toBe(200);
  });

  it('binds only to 127.0.0.1 and stops cleanly', async () => {
    fullProject();
    const s = await start();
    expect(s.host).toBe('127.0.0.1');
    expect(s.url).toBe(`http://127.0.0.1:${s.port}`);
    await s.close();
    server = null;
    await expect(http(s)).rejects.toThrow();
  });

  it('refuses a relative project root and a busy port', async () => {
    await expect(startDashboardServer({ projectRoot: 'relative/dir' })).rejects.toThrow(TypeError);
    const s = await start();
    await expect(startDashboardServer({ projectRoot: dir, port: s.port })).rejects.toThrow();
  });

  it('listens on exactly 127.0.0.1 (server.address(), not 0.0.0.0)', async () => {
    const listening: Server[] = [];
    const realListen = Server.prototype.listen;
    const spy = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (this: Server, ...args: unknown[]) {
      listening.push(this);
      return (realListen as (...a: unknown[]) => Server).apply(this, args);
    });
    let s: DashboardServer;
    try {
      s = await start();
    } finally {
      spy.mockRestore();
    }
    expect(listening).toHaveLength(1);
    expect(listening[0].address()).toEqual({ address: '127.0.0.1', family: 'IPv4', port: s.port });
  });

  it('refuses connections on a non-loopback interface address', async () => {
    const s = await start();
    const external = Object.values(networkInterfaces())
      .flat()
      .find((i) => i !== undefined && i.family === 'IPv4' && !i.internal)?.address;
    if (external === undefined) return; // no external IPv4 on this host; the address() test above still holds
    const code = await new Promise<string>((resolve) => {
      const sock = createConnection({ host: external, port: s.port });
      sock.once('connect', () => { sock.destroy(); resolve('CONNECTED'); });
      sock.once('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'ERR'));
    });
    expect(code).toBe('ECONNREFUSED');
  });

  it('accepts connections on 127.0.0.1', async () => {
    const s = await start();
    const addr = await new Promise<string>((resolve) => {
      const sock = createConnection({ host: '127.0.0.1', port: s.port }, () => {
        resolve(sock.remoteAddress ?? '');
        sock.destroy();
      });
    });
    expect(addr).toBe('127.0.0.1');
  });
});

describe('HTTP security', () => {
  it('rejects a Host that does not match the loopback name and real port', async () => {
    fullProject();
    const s = await start();
    for (const host of ['evil.example', `evil.example:${s.port}`, '127.0.0.1', `127.0.0.1:${s.port + 1}`, `0.0.0.0:${s.port}`, `127.0.0.1.evil.example:${s.port}`]) {
      const r = await http(s, { headers: { Host: host } });
      expect(r.status, host).toBe(403);
      expect(JSON.parse(r.body)).toEqual({ error: { kind: 'security', code: 'HOST_NOT_ALLOWED' } });
    }
    expect((await http(s, { headers: { Host: `localhost:${s.port}` } })).status).toBe(200);
  });

  describe('Host header cardinality (raw headers)', () => {
    /** Sends a hand-written request so the Host lines are exactly as given. */
    function raw(s: DashboardServer, hostLines: string[]): Promise<{ status: number; body: string }> {
      return new Promise((resolve, reject) => {
        const sock = createConnection({ host: '127.0.0.1', port: s.port });
        let data = '';
        sock.setEncoding('utf8');
        sock.on('data', (d: string) => { data += d; });
        sock.on('error', reject);
        sock.on('close', () => {
          const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1] ?? 0);
          resolve({ status, body: data.slice(data.indexOf('\r\n\r\n') + 4) });
        });
        sock.write(['GET /api/dashboard HTTP/1.1', ...hostLines, 'Connection: close', '', ''].join('\r\n'));
      });
    }
    const denied = { error: { kind: 'security', code: 'HOST_NOT_ALLOWED' } };

    it('accepts exactly one valid Host (either casing of the header name)', async () => {
      fullProject();
      const s = await start();
      expect((await raw(s, [`Host: 127.0.0.1:${s.port}`])).status).toBe(200);
      expect((await raw(s, [`hOsT: localhost:${s.port}`])).status).toBe(200);
    });

    it('rejects two identical Host headers without reading the project', async () => {
      fullProject();
      const s = await start();
      vi.mocked(readDashboardModel).mockClear();
      const h = `127.0.0.1:${s.port}`;
      const r = await raw(s, [`Host: ${h}`, `Host: ${h}`]);
      expect(r.status).toBe(403);
      expect(JSON.parse(r.body)).toEqual(denied);
      expect(readDashboardModel).not.toHaveBeenCalled();
    });

    it('rejects two different Host headers in either order, valid or not', async () => {
      fullProject();
      const s = await start();
      vi.mocked(readDashboardModel).mockClear();
      const ok = `127.0.0.1:${s.port}`;
      for (const lines of [[`Host: ${ok}`, 'Host: evil.example'], ['Host: evil.example', `Host: ${ok}`], [`Host: ${ok}`, `Host: localhost:${s.port}`]]) {
        const r = await raw(s, lines);
        expect(r.status, lines.join('|')).toBe(403);
        expect(JSON.parse(r.body)).toEqual(denied);
        expect(r.body).not.toContain('evil');
      }
      expect(readDashboardModel).not.toHaveBeenCalled();
    });

    it('rejects duplicates that differ only in header-name case', async () => {
      fullProject();
      const s = await start();
      vi.mocked(readDashboardModel).mockClear();
      const h = `127.0.0.1:${s.port}`;
      for (const lines of [[`Host: ${h}`, `host: ${h}`], [`HOST: ${h}`, `hOsT: ${h}`]]) {
        const r = await raw(s, lines);
        expect(r.status, lines.join('|')).toBe(403);
        expect(JSON.parse(r.body)).toEqual(denied);
      }
      expect(readDashboardModel).not.toHaveBeenCalled();
    });

    it('rejects a missing Host and an invalid Host', async () => {
      fullProject();
      const s = await start();
      vi.mocked(readDashboardModel).mockClear();
      for (const lines of [[], ['Host: '], ['Host: evil.example'], [`Host: 127.0.0.1.evil.example:${s.port}`]]) {
        const r = await raw(s, lines);
        expect(r.status, lines.join('|')).toBeGreaterThanOrEqual(400);
        expect(r.status).toBeLessThan(500);
        if (r.status === 403) expect(JSON.parse(r.body)).toEqual(denied);
      }
      expect(readDashboardModel).not.toHaveBeenCalled();
    });

    it('does not echo raw headers in the rejection', async () => {
      fullProject();
      const s = await start();
      const r = await raw(s, ['Host: leak-a.example', 'Host: leak-b.example']);
      expect(r.status).toBe(403);
      expect(r.body).not.toMatch(/leak|rawHeaders|\.example/i);
      expect(JSON.parse(r.body)).toEqual(denied);
      expect(Object.keys(JSON.parse(r.body))).toEqual(['error']);
    });
  });

  it('rejects an invalid Origin, never reflects it and sets no CORS headers', async () => {
    fullProject();
    const s = await start();
    for (const origin of ['http://evil.example', 'null', '*', `http://127.0.0.1:${s.port + 1}`, `https://127.0.0.1:${s.port}`]) {
      const r = await http(s, { headers: { Origin: origin } });
      expect(r.status, origin).toBe(403);
      expect(JSON.parse(r.body)).toEqual({ error: { kind: 'security', code: 'ORIGIN_NOT_ALLOWED' } });
      expect(noAccessControl(r)).toEqual([]);
      expect(r.body).not.toContain('evil');
    }
  });

  it('accepts the server\'s own Origin and still sends no CORS headers', async () => {
    fullProject();
    const s = await start();
    const r = await http(s, { headers: { Origin: s.url } });
    expect(r.status).toBe(200);
    expect(noAccessControl(r)).toEqual([]);
    expect(noAccessControl(await http(s))).toEqual([]);
  });

  it('rejects POST/PUT/PATCH/DELETE/OPTIONS/HEAD with 405 and Allow: GET', async () => {
    fullProject();
    const s = await start();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
      const r = await http(s, { method });
      expect(r.status, method).toBe(405);
      expect(r.headers.allow).toBe('GET');
      expect(noAccessControl(r)).toEqual([]);
      if (method !== 'HEAD') expect(JSON.parse(r.body)).toEqual({ error: { kind: 'request', code: 'METHOD_NOT_ALLOWED' } });
    }
  });

  it('rejects unknown routes', async () => {
    fullProject();
    const s = await start();
    for (const path of ['/', '/api', '/api/dashboard/', '/api/Dashboard', '/api/dashboard/../x', '/api/%64ashboard', '/api/state', '/health', '//api/dashboard', 'http://x/api/dashboard']) {
      const r = await http(s, { path });
      expect(r.status, path).toBe(404);
      expect(JSON.parse(r.body)).toEqual({ error: { kind: 'request', code: 'NOT_FOUND' } });
    }
  });

  it('the request cannot choose the project root', async () => {
    fullProject();
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'http-other-')));
    try {
      fullProject(other, 'Other');
      const s = await start();
      const r = await http(s, {
        path: `/api/dashboard?projectRoot=${encodeURIComponent(other)}&root=${encodeURIComponent(other)}`,
        headers: { 'X-Project-Root': other, 'X-Monolith-Root': other, Cookie: `projectRoot=${other}` },
      });
      expect(r.status).toBe(200);
      expect(dto(r).projectOverview.data?.name).toBe('Demo');
      expect(r.body).not.toContain('Other');
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('errors expose no absolute path, stack or exception text', async () => {
    fullProject();
    const s = await start(10);
    const responses = [
      await http(s, { headers: { Host: 'evil.example' } }),
      await http(s, { headers: { Origin: 'http://evil.example' } }),
      await http(s, { path: '/nope' }),
      await http(s, { method: 'POST' }),
      await http(s), // RESPONSE_TOO_LARGE
    ];
    for (const r of responses) {
      expect(r.body).not.toContain(dir);
      expect(r.body).not.toContain(tmpdir());
      expect(r.body).not.toMatch(/\bat \S+ \(|Error:|stack|\/home\//);
      expect(Object.keys(JSON.parse(r.body))).toEqual(['error']);
    }
  });

  it('over-limit DTO yields a typed error, never partial JSON or content', async () => {
    fullProject();
    write(`.monolith/${ROADMAP_REL}`, 'SECRET-ROADMAP-TEXT '.repeat(200));
    const s = await start(1024);
    const r = await http(s);
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body)).toEqual({ error: { kind: 'dashboard', code: 'RESPONSE_TOO_LARGE' } });
    expect(r.body).not.toContain('SECRET');
    expect(Number(r.headers['content-length'])).toBe(Buffer.byteLength(r.body));
  });

  it('has an explicit default response limit and serves under it', async () => {
    expect(MAX_RESPONSE_BYTES).toBe(2 * 1024 * 1024);
    fullProject();
    const r = await http(await start());
    expect(r.status).toBe(200);
    expect(Buffer.byteLength(r.body)).toBeLessThan(MAX_RESPONSE_BYTES);
  });
});

describe('Core integration', () => {
  it('an absent optional source is DTO data, not an HTTP error', async () => {
    write('monolith.config.json', JSON.stringify({ project: { name: 'Demo' } }));
    const r = await http(await start());
    expect(r.status).toBe(200);
    const m = dto(r);
    expect(m.diagnostics.sources.find((x) => x.id === 'state')).toMatchObject({ status: 'absent', code: 'SOURCE_ABSENT' });
    expect(m.roadmap.data).toBeNull();
    expect(m).toEqual(readDashboardModel(dir));
  });

  it('a symlinked source stays fail-closed and its target content is not served', async () => {
    fullProject();
    write('state.json', stateJson().replace('"revision":3', '"revision":999').replace(/MIS-0001/g, 'LEAKED-ID'), outside);
    rmSync(join(dir, '.monolith/state.json'));
    symlinkSync(join(outside, 'state.json'), join(dir, '.monolith/state.json'));
    const r = await http(await start());
    expect(r.status).toBe(200);
    const m = dto(r);
    expect(m.diagnostics.sources.find((x) => x.id === 'state')).toMatchObject({ status: 'forbidden', code: 'SOURCE_SYMLINK' });
    expect(m.currentMissions.data).toBeNull();
    expect(r.body).not.toContain('LEAKED-ID');
    expect(r.body).not.toContain(outside);
  });

  it('a hardlinked source stays fail-closed and its content is not served', async () => {
    fullProject();
    write('roadmap-secret.md', 'HARDLINK-SECRET', outside);
    const target = join(dir, `.monolith/${ROADMAP_REL}`);
    rmSync(target);
    linkSync(join(outside, 'roadmap-secret.md'), target);
    const r = await http(await start());
    const m = dto(r);
    expect(m.diagnostics.sources.find((x) => x.id === 'roadmap')).toMatchObject({ status: 'forbidden', code: 'SOURCE_HARDLINKED' });
    expect(m.roadmap.data).toBeNull();
    expect(r.body).not.toContain('HARDLINK-SECRET');
  });

  it('SourceReport keeps typed codes for corrupt input', async () => {
    fullProject();
    write('.monolith/state.json', '{not json');
    const m = dto(await http(await start()));
    expect(m.diagnostics.sources.find((x) => x.id === 'state')).toMatchObject({ status: 'corrupt', code: 'PARSE_ERROR' });
    expect(m.diagnostics.validation).toBe('NOT_PERFORMED');
  });

  it('an untrusted instance root is reported as data and nothing below it is read', async () => {
    write('monolith.config.json', JSON.stringify({ monolithRoot: '../escape' }));
    const r = await http(await start());
    expect(r.status).toBe(200);
    const m = dto(r);
    expect(m.projectOverview.data).toBeNull();
    expect(m.diagnostics.sources.every((x) => x.status === 'forbidden' || x.id === 'config')).toBe(true);
    expect(r.body).not.toContain(dir);
  });
});

describe('architecture guards', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const code = readFileSync(join(here, 'server.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('the HTTP layer imports no filesystem module and no Core state/storage', () => {
    const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(imports)].sort()).toEqual(['../readmodel/index.js', 'http', 'path']);
    expect(code).not.toMatch(/\b(readFileSync|readdirSync|createReadStream|openSync|readFile|existsSync|statSync)\b/);
  });

  it('knows nothing of state layout, history or the manifest', () => {
    expect(code).not.toMatch(/CoordinatoriumState|tactical|checkpoints|jsonl|manifest|history|state\.json/i);
  });

  it('declares no write-capable or CORS surface', () => {
    expect(code).not.toMatch(/Access-Control|0\.0\.0\.0|'POST'|'PUT'|'DELETE'|'PATCH'/);
  });
});
