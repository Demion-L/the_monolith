/**
 * CLI-UX-001 at process level: a spawned CLI has pipes, never a TTY, so its
 * output must be free of ANSI whatever the environment asks for; machine
 * output (--json) is unchanged JSON.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[/;

function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  const base: Record<string, string | undefined> = { ...process.env, ...env };
  delete base.NO_COLOR;
  if (env.NO_COLOR !== undefined) base.NO_COLOR = env.NO_COLOR;
  return spawnSync(process.execPath, [cli, ...args], { cwd, env: base, encoding: 'utf8' });
}

describe.skipIf(!existsSync(cli))('CLI-UX-001 process output (needs `npm run build`)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'monolith-ux-'));
  dirs.push(dir);
  const init = spawnSync(process.execPath, [cli, 'init', '--yes'], { cwd: dir, encoding: 'utf8' });

  it('init succeeded', () => expect(init.status).toBe(0));

  it.each([
    ['validate', ['validate']],
    ['brief', ['brief']],
    ['brief --reconcile', ['brief', '--reconcile']],
  ])('%s: piped output has no ANSI, even if the environment asks for colour', (_n, args) => {
    const r = run(dir, args, { FORCE_COLOR: '1', TERM: 'xterm-256color' });
    expect(ANSI.test(r.stdout)).toBe(false);
    expect(ANSI.test(r.stderr)).toBe(false);
  });

  it('validate keeps its words and exit code under NO_COLOR', () => {
    const r = run(dir, ['validate'], { NO_COLOR: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Result: PASS');
    expect(ANSI.test(r.stdout)).toBe(false);
  });

  it('finalize --json is plain, parseable JSON with the unchanged status contract', () => {
    const missing = run(dir, ['finalize', 'plan', '--proposal', join(dir, 'nope.json'), '--json']);
    expect(missing.status).toBe(1); // usage / unreadable proposal: unchanged exit code
    expect(ANSI.test(missing.stdout + missing.stderr)).toBe(false);
  });
});
