/** GOV-EVOLUTION Phase 6: Claude Code hooks — read-only, fail-safe, non-blocking, no duplicated rules. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldInstance } from '../init/scaffold.js';
import { buildSessionContext, handleSessionStart, handleStop, hookConfigSnippet, parseHookInput } from './index.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');
let dir: string;
beforeEach(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hook-')));
  const log = console.log;
  console.log = () => undefined;
  try {
    await scaffoldInstance(dir, { projectName: 'F', language: 'typescript', packageManager: 'pnpm', aiTool: 'claude', finalizationProtocol: 'finalize-story', protocols: ['finalize-story'], monolithRoot: '.monolith' });
  } finally {
    console.log = log;
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const snap = (root: string): string => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(`${p}:${st.size}:${st.mtimeMs}`);
    }
  };
  walk(root);
  return out.join('\n');
};

describe('hook handlers', () => {
  it('session-start injects context from Core, writes nothing', () => {
    const before = snap(dir);
    const out = handleSessionStart(dir) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart');
    const t = out.hookSpecificOutput.additionalContext;
    expect(t).toContain('Active story: none recorded');
    expect(t).toContain('Active mission: none');
    expect(t).toContain('Governance check: no issues.');
    expect(snap(dir)).toBe(before);
  });

  it('reports governance issues but does not stop anything', () => {
    mkdirSync(join(dir, 'docs/adr'), { recursive: true });
    writeFileSync(join(dir, 'docs/adr/ADR-001-x.md'), '# no frontmatter\n');
    const { lines, report } = buildSessionContext(dir);
    expect(report.result).toBe('ISSUES_FOUND');
    expect(lines.join('\n')).toContain('ADR_FRONTMATTER_MISSING');
    const stop = handleStop(dir, {}) as { systemMessage: string };
    expect(stop.systemMessage).toContain('governance check reports');
    expect(Object.keys(stop)).toEqual(['systemMessage']); // never decision / continue:false
  });

  it('stop is silent on a clean project and when stop_hook_active (no loop)', () => {
    expect(handleStop(dir, {})).toBeNull();
    mkdirSync(join(dir, 'docs/adr'), { recursive: true });
    writeFileSync(join(dir, 'docs/adr/ADR-001-x.md'), '# no frontmatter\n');
    expect(handleStop(dir, { stop_hook_active: true })).toBeNull();
  });

  it('fails safe outside a project', () => {
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'hook-empty-')));
    try {
      const out = handleSessionStart(empty) as { hookSpecificOutput?: { additionalContext: string }; systemMessage?: string };
      expect(JSON.stringify(out)).toBeTruthy();
      expect(out.hookSpecificOutput?.additionalContext ?? out.systemMessage).toContain('MONOLITH');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('parses hook input leniently', () => {
    expect(parseHookInput('{"stop_hook_active":true}')).toEqual({ stop_hook_active: true });
    expect(parseHookInput('garbage')).toEqual({});
    expect(parseHookInput('[1]')).toEqual({});
  });

  it('the config snippet is valid, opt-in text with a fail-safe command', () => {
    const cfg = JSON.parse(hookConfigSnippet());
    const cmd = cfg.hooks.SessionStart[0].hooks[0].command as string;
    expect(cmd).toContain('command -v monolith');
    expect(cmd.endsWith('|| true')).toBe(true);
    expect(Object.keys(cfg.hooks).sort()).toEqual(['PreCompact', 'SessionStart', 'Stop']);
  });
});

describe('hook CLI process (needs `pnpm build`)', () => {
  it('session-start prints JSON and exits 0; recursion guard exits silently; usage error is 1', () => {
    const run = (args: string[], env: Record<string, string> = {}, input = '{}') =>
      spawnSync('node', [CLI, ...args], { cwd: dir, input, env: { ...process.env, ...env }, encoding: 'utf8' });
    const a = run(['hook', 'session-start']);
    expect(a.status).toBe(0);
    expect(JSON.parse(a.stdout).hookSpecificOutput.hookEventName).toBe('SessionStart');
    const b = run(['hook', 'session-start'], { MONOLITH_HOOK_ACTIVE: '1' });
    expect([b.status, b.stdout]).toEqual([0, '']);
    expect(run(['hook', 'bogus']).status).toBe(1);
    expect(run(['hook', 'stop'], {}, '{"stop_hook_active":true}').stdout).toBe('');
    expect(JSON.parse(execFileSync('node', [CLI, 'hook', 'print-config'], { encoding: 'utf8' })).hooks.Stop).toBeDefined();
    expect(readFileSync(join(dir, 'monolith.config.json'), 'utf8')).toContain('"F"');
  });
});
