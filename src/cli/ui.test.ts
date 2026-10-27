import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createServer, request } from 'http';
import { createConnection } from 'net';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { parseUiArgs } from './ui-args.js';

const REPO = resolve(__dirname, '..', '..');
const TSC = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');

const dirs: string[] = [];
const children: ChildProcess[] = [];
let outDir: string;
let cli: string;

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function project(): string {
  const proj = join(tmp('ui-cli-proj-'), 'project');
  mkdirSync(join(proj, '.monolith', 'memory', 'working'), { recursive: true });
  writeFileSync(join(proj, 'monolith.config.json'), JSON.stringify({ monolithRoot: '.monolith' }));
  return proj;
}

/** Everything under `dir` with size+mtime, to prove the run wrote nothing. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const st = statSync(p);
      out.push(`${p} ${st.isDirectory() ? 'd' : st.size} ${st.mtimeMs}`);
      if (st.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}

function run(args: string[], cwd: string) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 15_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
    s.on('error', rej);
  });
}

function start(cwd: string, port: number): Promise<{ child: ChildProcess; url: string; exit: Promise<number | null> }> {
  const child = spawn(process.execPath, [cli, 'ui', '--port', String(port)], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const exit = new Promise<number | null>((r) => child.once('exit', (code) => r(code)));
  return new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error(`no ready line: ${buf}`)), 10_000);
    child.stdout!.on('data', (c) => {
      buf += c;
      const m = /Mission Control: (http:\/\/127\.0\.0\.1:\d+)/.exec(buf);
      if (m) {
        clearTimeout(t);
        res({ child, url: m[1], exit });
      }
    });
    child.once('exit', () => rej(new Error(`exited early: ${buf}`)));
  });
}

function get(port: number, path: string, opts: { method?: string; host?: string } = {}) {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((res, rej) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers: { Host: opts.host ?? `127.0.0.1:${port}` }, agent: false },
      (r) => {
        let body = '';
        r.on('data', (c) => (body += c));
        r.on('end', () => res({ status: r.statusCode ?? 0, body, headers: r.headers }));
      },
    );
    req.on('error', rej);
    req.end();
  });
}

function refused(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = createConnection({ host: '127.0.0.1', port });
    s.once('connect', () => { s.destroy(); res(false); });
    s.once('error', () => res(true));
  });
}

beforeAll(() => {
  outDir = tmp('ui-cli-build-');
  execFileSync(
    process.execPath,
    [TSC, '-p', join(REPO, 'tsconfig.json'), '--outDir', outDir, '--tsBuildInfoFile', join(outDir, 'tsbuildinfo')],
    { cwd: REPO, stdio: 'pipe' },
  );
  cli = join(outDir, 'cli', 'index.js');
  // A fixture build next to the compiled CLI, where the packaged CLI looks for dist/ui.
  mkdirSync(join(outDir, 'ui', 'assets'), { recursive: true });
  writeFileSync(join(outDir, 'ui', 'index.html'), '<!doctype html><title>fixture</title><script type="module" src="./assets/app.js"></script>');
  writeFileSync(join(outDir, 'ui', 'assets', 'app.js'), 'export {}');
}, 120_000);

afterAll(() => {
  for (const c of children) if (c.exitCode === null) c.kill('SIGKILL');
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('parseUiArgs', () => {
  it('defaults', () => {
    expect(parseUiArgs([])).toEqual({ ok: true, help: false, dev: false, port: null });
    expect(parseUiArgs(['dev', '--port', '5000'])).toEqual({ ok: true, help: false, dev: true, port: 5000 });
    expect(parseUiArgs(['--port=4000'])).toMatchObject({ ok: true, port: 4000 });
    expect(parseUiArgs(['dev', '-h'])).toEqual({ ok: true, help: true, dev: true });
  });

  it.each([['--port'], ['--port', 'abc'], ['--port', '0'], ['--port', '65536'], ['--port', '-1'], ['--port', '80.5']])(
    'rejects a bad port %j',
    (...args) => {
      expect(parseUiArgs(args).ok).toBe(false);
    },
  );

  it('rejects unknown arguments, a misplaced dev and --host', () => {
    expect(parseUiArgs(['--bogus']).ok).toBe(false);
    expect(parseUiArgs(['--port', '4000', 'dev']).ok).toBe(false);
    const host = parseUiArgs(['--host', '0.0.0.0']);
    expect(host.ok === false && host.message).toContain('127.0.0.1 only');
  });
});

describe('monolith ui (compiled CLI)', () => {
  it('prints its own help for `ui --help` and `ui dev --help`', () => {
    const a = run(['ui', '--help'], tmpdir());
    expect(a.code).toBe(0);
    expect(a.out).toContain('monolith ui [--port N]');
    expect(a.out).not.toContain('Commands:');
    const b = run(['ui', 'dev', '--help'], tmpdir());
    expect(b.code).toBe(0);
    expect(b.out).toContain('Vite dev server');
  });

  it('fails cleanly on an unknown argument, a bad port and --host', () => {
    const cwd = project();
    for (const args of [['ui', '--bogus'], ['ui', '--port', 'x'], ['ui', '--port', '70000'], ['ui', '--host', '0.0.0.0']]) {
      const r = run(args, cwd);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.err).not.toMatch(/\n\s+at /);
    }
  });

  it('fails cleanly outside a MONOLITH project', () => {
    const empty = tmp('ui-cli-empty-');
    const r = run(['ui', '--port', String(40000 + (process.pid % 1000))], empty);
    expect(r.code).toBe(1);
    expect(r.err).toContain('No MONOLITH instance found');
    expect(r.err).not.toMatch(/\n\s+at /);
  });

  it('fails cleanly when the port is busy', async () => {
    const cwd = project();
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const port = (blocker.address() as { port: number }).port;
    try {
      const r = run(['ui', '--port', String(port)], cwd);
      expect(r.code).toBe(1);
      expect(r.err).toContain(`Port ${port} is already in use`);
    } finally {
      blocker.close();
    }
  });

  it('serves the UI and the read-only API, writes nothing, and stops on SIGTERM releasing the port', async () => {
    const cwd = project();
    const before = snapshot(cwd);
    const port = await freePort();
    const { child, exit } = await start(cwd, port);

    const page = await get(port, '/');
    expect(page.status).toBe(200);
    expect(page.body).toContain('fixture');
    expect(String(page.headers['content-security-policy'])).toContain("default-src 'none'");
    expect((await get(port, '/assets/app.js')).status).toBe(200);
    const api = await get(port, '/api/dashboard');
    expect(api.status).toBe(200);
    expect(JSON.parse(api.body)).toHaveProperty('projectOverview');

    // No write surface: every non-GET is refused, a foreign Host is refused, traversal finds nothing.
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await get(port, '/api/dashboard', { method })).status, method).toBe(405);
      expect((await get(port, '/', { method })).status, method).toBe(405);
    }
    expect((await get(port, '/', { host: 'evil.example' })).status).toBe(403);
    expect((await get(port, '/../../etc/passwd')).status).toBe(404);

    child.kill('SIGTERM');
    expect(await exit).toBe(0);
    expect(await refused(port)).toBe(true);
    expect(snapshot(cwd)).toEqual(before);
  }, 30_000);

  it('stops on SIGINT too', async () => {
    const port = await freePort();
    const { child, exit } = await start(project(), port);
    child.kill('SIGINT');
    expect(await exit).toBe(0);
    expect(await refused(port)).toBe(true);
  }, 30_000);

  it('refuses `ui dev` outside a source checkout', () => {
    const r = run(['ui', 'dev', '--port', '45999'], project());
    expect(r.code).toBe(1);
    expect(r.err).toContain('source checkout');
  });

  it('production runtime does not import Vite', () => {
    for (const file of ['cli/ui.js', 'cli/ui-args.js', 'http/server.js', 'http/ui-assets.js', 'http/index.js']) {
      const src = readFileSync(join(outDir, file), 'utf8');
      expect(src, file).not.toMatch(/(?:from|import\s*\(?|require\s*\()\s*['"](?:npm:)?vite(?:\/|['"])/);
    }
    // The CLI entry itself loads `ui` lazily, so other commands never pay for it.
    expect(readFileSync(join(outDir, 'cli', 'index.js'), 'utf8')).not.toMatch(/^import .* from ['"]\.\/ui\.js['"]/m);
  });
});
