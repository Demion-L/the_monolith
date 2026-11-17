import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from 'http';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startDashboardServer, VALIDATE_PATH, RECONCILE_PATH, MAX_REQUEST_BODY_BYTES } from './index.js';
import type { DashboardServer } from './index.js';
import { runReconciliation, runValidation } from '../readmodel/index.js';
import type { ReconciliationResultDto, ValidationResultDto } from '../readmodel/index.js';
import { scaffoldInstance } from '../init/scaffold.js';
import type { ProjectConfig } from '../types/index.js';

// Pass-through spies: prove a refused request never reaches Core, and that concurrent runs share one.
vi.mock('../readmodel/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../readmodel/index.js')>();
  return { ...actual, runValidation: vi.fn(actual.runValidation), runReconciliation: vi.fn(actual.runReconciliation) };
});

let dir: string;
let server: DashboardServer | null;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'diag-proj-')));
  server = null;
  vi.mocked(runValidation).mockClear();
  vi.mocked(runReconciliation).mockClear();
});
afterEach(async () => {
  await server?.close();
  rmSync(dir, { recursive: true, force: true });
});

const CONFIG: ProjectConfig = {
  projectName: 'diag',
  language: 'typescript',
  packageManager: 'pnpm',
  aiTool: 'claude',
  finalizationProtocol: 'finalize-story',
  protocols: ['finalize-story'],
  monolithRoot: '.monolith',
};

async function scaffold(): Promise<void> {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await scaffoldInstance(dir, CONFIG);
  vi.restoreAllMocks();
}

function write(rel: string, content: string): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function git(...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' });
}

/** Path -> content hash of every file under `dir` (excluding .git, whose index git itself refreshes), plus mtimes. */
function snapshot(): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '.git') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${p.slice(dir.length)}:${createHash('sha1').update(readFileSync(p)).digest('hex')}:${statSync(p).mtimeMs}`);
    }
  };
  walk(dir);
  return out.join('\n');
}

interface Res { status: number; headers: Record<string, string | string[] | undefined>; body: string }
function post(
  s: DashboardServer,
  path: string,
  opts: { method?: string; headers?: Record<string, string | undefined>; body?: string | null } = {},
): Promise<Res> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (v === undefined) delete headers[k];
    else headers[k] = v;
  }
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: s.port, method: opts.method ?? 'POST', path, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(opts.body === null ? undefined : (opts.body ?? '{}'));
  });
}
async function start(): Promise<DashboardServer> {
  server = await startDashboardServer({ projectRoot: dir });
  return server;
}
const validation = (r: Res) => JSON.parse(r.body) as ValidationResultDto;
const reconciliation = (r: Res) => JSON.parse(r.body) as ReconciliationResultDto;

describe('POST /api/diagnostics/validate', () => {
  it('runs Core validation and returns a structured PASS, changing no file', async () => {
    await scaffold();
    const before = snapshot();
    const r = await post(await start(), VALIDATE_PATH);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(r.headers['cache-control']).toBe('no-store');
    const v = validation(r);
    expect(v.result).toBe('PASS');
    expect(v.checks.map((c) => [c.id, c.passed])).toEqual([['configuration', true], ['instance', true], ['templates', true]]);
    // The configuration PASS carries Core's own qualification: the definition file was not executed.
    expect(v.checks[0].note).toContain('not parsed or executed');
    expect(v.checks.every((c) => c.message === null)).toBe(true);
    expect(snapshot()).toBe(before);
  });

  it('reports FAIL per check, in project-relative terms, with no absolute path', async () => {
    await scaffold();
    rmSync(join(dir, '.monolith', 'protocols'), { recursive: true });
    const r = await post(await start(), VALIDATE_PATH);
    expect(r.status).toBe(200);
    const v = validation(r);
    expect(v.result).toBe('FAIL');
    expect(v.checks.find((c) => c.id === 'instance')).toMatchObject({ passed: false, message: 'missing .monolith/protocols/' });
    expect(v.checks.find((c) => c.id === 'configuration')?.passed).toBe(true);
    expect(r.body).not.toContain(dir);
  });

  it('does not execute project.definition.mjs', async () => {
    await scaffold();
    const marker = join(dir, 'executed.txt');
    write('project.definition.mjs', `import { writeFileSync } from 'fs';\nwriteFileSync(${JSON.stringify(marker)}, 'ran');\nexport const PROJECT_DEFINITION = {};\n`);
    const r = await post(await start(), VALIDATE_PATH);
    expect(validation(r).result).toBe('PASS');
    expect(() => statSync(marker)).toThrow();
  });

  it('is never an absolute-path leak when the project is not a MONOLITH project', async () => {
    const r = await post(await start(), VALIDATE_PATH);
    expect(r.status).toBe(200);
    expect(validation(r).result).toBe('FAIL');
    expect(r.body).not.toContain(dir);
  });
});

describe('POST /api/diagnostics/reconcile', () => {
  it('shows a confirmed contradiction as the two conflicting claims, and writes nothing', async () => {
    await scaffold();
    write('.monolith/memory/working/active.md', '# Active\n\n## Current Story\n\nNo active story.\n');
    write('.monolith/context/maps/roadmap-index.md', '# Roadmap\n\nActive Story: SUPPORT-003\n');
    const before = snapshot();
    const r = await post(await start(), RECONCILE_PATH);
    expect(r.status).toBe(200);
    const d = reconciliation(r);
    expect(d.conflicts).toHaveLength(1);
    expect(d.conflicts[0].sources).toEqual([
      { document: 'active.md', claim: 'No active story' },
      { document: 'roadmap-index.md', claim: 'Active Story: SUPPORT-003' },
    ]);
    // Core's Freshness semantics are passed through; the project is not a git repo, so the evidence is UNKNOWN.
    expect(d.freshness).toBe('STALE');
    expect(d.evidence).toBe('UNKNOWN');
    expect(d.evidenceIssues.map((n) => n.code)).toContain('GIT_UNAVAILABLE');
    expect(d.actions.length).toBeGreaterThan(0);
    expect(d.limitations.length).toBeGreaterThan(0);
    expect(r.body).not.toContain(dir);
    expect(snapshot()).toBe(before);
  });

  it('without git evidence and without contradictions: UNKNOWN, not STALE, and no invented conflict', async () => {
    await scaffold();
    const d = reconciliation(await post(await start(), RECONCILE_PATH));
    expect(d.freshness).toBe('UNKNOWN');
    expect(d.evidence).toBe('UNKNOWN');
    expect(d.conflicts).toEqual([]);
    expect(d.unrecordedWork).toEqual([]);
  });

  it('with complete git evidence and nothing to report: COMPLETE and FRESH', async () => {
    await scaffold();
    write('.monolith/memory/working/active.md', '# Active\n\n## Current Story\n\nNo active story.\n');
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    const before = snapshot();
    const d = reconciliation(await post(await start(), RECONCILE_PATH));
    expect(d.evidence).toBe('COMPLETE');
    expect(d.freshness).toBe('FRESH');
    expect(d.lastStateUpdate?.sha).toMatch(/^[0-9a-f]{7}$/);
    expect(d.conflicts).toEqual([]);
    expect(snapshot()).toBe(before);
  });

  it('lists work items that git references but no state document mentions, as unrecorded (not as done)', async () => {
    await scaffold();
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'state');
    write('src/x.ts', 'export {};\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'feat: ZZZ-042 does a thing');
    const d = reconciliation(await post(await start(), RECONCILE_PATH));
    expect(d.freshness).toBe('STALE');
    expect(d.unrecordedWork).toHaveLength(1);
    expect(d.unrecordedWork[0]).toMatchObject({ id: 'ZZZ-042', totalCommits: 1 });
    expect(d.unrecordedWork[0].commits[0].subject).toBe('feat: ZZZ-042 does a thing');
    expect(d.limitations.join(' ')).toContain('not evidence that a work item is complete');
  });
});

describe('request contract', () => {
  it('accepts only POST on the diagnostic routes, with Allow: POST', async () => {
    await scaffold();
    const s = await start();
    for (const path of [VALIDATE_PATH, RECONCILE_PATH]) {
      for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
        const r = await post(s, path, { method, body: null });
        expect(r.status, `${method} ${path}`).toBe(405);
        expect(r.headers.allow).toBe('POST');
        expect(Object.keys(r.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
      }
    }
    expect(vi.mocked(runValidation)).not.toHaveBeenCalled();
    expect(vi.mocked(runReconciliation)).not.toHaveBeenCalled();
  });

  it('rejects other routes under /api/diagnostics and path tricks', async () => {
    const s = await start();
    for (const path of ['/api/diagnostics', '/api/diagnostics/validate/', '/api/diagnostics/validate?root=/etc', '/api/diagnostics/other', '/api/diagnostics/%76alidate']) {
      const r = await post(s, path);
      if (path.startsWith('/api/diagnostics/validate?')) expect(r.status).toBe(200); // the query is never interpreted
      else expect(r.status, path).toBe(404);
    }
  });

  it('requires JSON content type and an empty or {} body', async () => {
    await scaffold();
    const s = await start();
    for (const ct of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'application/json-patch+json']) {
      const r = await post(s, VALIDATE_PATH, { headers: { 'Content-Type': ct } });
      expect(r.status, String(ct)).toBe(415);
      expect(JSON.parse(r.body)).toEqual({ error: { kind: 'request', code: 'UNSUPPORTED_MEDIA_TYPE' } });
    }
    expect((await post(s, VALIDATE_PATH, { body: '{"root":"/etc"}' })).status).toBe(400);
    expect((await post(s, VALIDATE_PATH, { body: '[]' })).status).toBe(400);
    expect((await post(s, VALIDATE_PATH, { body: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1) })).status).toBe(413);
    expect(vi.mocked(runValidation)).not.toHaveBeenCalled();
    expect((await post(s, VALIDATE_PATH, { body: '' })).status).toBe(200);
    expect((await post(s, VALIDATE_PATH, { headers: { 'Content-Type': 'application/json; charset=utf-8' } })).status).toBe(200);
  });

  it('applies the Host and Origin checks before anything runs', async () => {
    await scaffold();
    const s = await start();
    const foreignHost = await post(s, VALIDATE_PATH, { headers: { Host: 'evil.example' } });
    expect(foreignHost.status).toBe(403);
    expect(JSON.parse(foreignHost.body)).toEqual({ error: { kind: 'security', code: 'HOST_NOT_ALLOWED' } });
    const foreignOrigin = await post(s, RECONCILE_PATH, { headers: { Origin: 'http://evil.example' } });
    expect(foreignOrigin.status).toBe(403);
    expect(JSON.parse(foreignOrigin.body)).toEqual({ error: { kind: 'security', code: 'ORIGIN_NOT_ALLOWED' } });
    expect(Object.keys(foreignOrigin.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
    expect(vi.mocked(runValidation)).not.toHaveBeenCalled();
    expect(vi.mocked(runReconciliation)).not.toHaveBeenCalled();
    // The server's own origin is fine.
    expect((await post(s, VALIDATE_PATH, { headers: { Origin: s.url } })).status).toBe(200);
  });

  it('a failure is a fixed code, never exception text or a path', async () => {
    await scaffold();
    vi.mocked(runValidation).mockImplementationOnce(() => {
      throw new Error(`boom at ${dir}/secret`);
    });
    const r = await post(await start(), VALIDATE_PATH);
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body)).toEqual({ error: { kind: 'diagnostics', code: 'DIAGNOSTICS_FAILED' } });
    expect(r.body).not.toContain('boom');
  });

  it('a request that arrives while the same diagnostic is running shares that run; a later one starts a new run', async () => {
    await scaffold();
    const s = await start();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const actual = await vi.importActual<typeof import('../readmodel/index.js')>('../readmodel/index.js');
    vi.mocked(runReconciliation).mockImplementationOnce(async (root: string) => {
      await gate;
      return actual.runReconciliation(root);
    });
    const first = post(s, RECONCILE_PATH);
    await vi.waitFor(() => expect(vi.mocked(runReconciliation)).toHaveBeenCalledTimes(1));
    const second = post(s, RECONCILE_PATH);
    // Give the second request time to arrive and be parked on the running task.
    await new Promise((r) => setTimeout(r, 100));
    expect(vi.mocked(runReconciliation)).toHaveBeenCalledTimes(1);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body).toBe(b.body);
    expect(vi.mocked(runReconciliation)).toHaveBeenCalledTimes(1);
    expect((await post(s, RECONCILE_PATH)).status).toBe(200);
    expect(vi.mocked(runReconciliation)).toHaveBeenCalledTimes(2);
  });

  it('validate and reconcile are independent', async () => {
    await scaffold();
    const s = await start();
    await post(s, VALIDATE_PATH);
    expect(vi.mocked(runReconciliation)).not.toHaveBeenCalled();
    await post(s, RECONCILE_PATH);
    expect(vi.mocked(runValidation)).toHaveBeenCalledTimes(1);
  });
});
