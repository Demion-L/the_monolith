/** Autonomous Execution Discipline — Managed Execution hook behaviour (scenarios A, B, C, D, I, J + classification). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handlePreToolUse, hookConfigSnippet, buildExecutionLines, type HookInput } from './index.js';
import { classifyBashCommand, classifyToolUse } from './classify.js';
import { buildExecutionStatus } from './execution-status.js';
import { resolveStateLocation, stateReadTargetOf } from '../coordinatorium/state-location.js';
import { listMissions } from '../coordinatorium/mission.js';

let base: string;
let main: string;
let wtB: string;
const git = (cwd: string, ...a: string[]): void => void execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, stdio: 'ignore' });
const missions = async (dir: string) => listMissions(stateReadTargetOf(resolveStateLocation(dir)));
const write = (dir: string, file: string, session = 's1'): HookInput => ({ session_id: session, cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: join(dir, file), content: 'x' } });
const setMode = (dir: string, execution: object): void => writeFileSync(join(dir, 'monolith.config.json'), JSON.stringify({ execution }));

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'managed-')));
  main = join(base, 'main');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  setMode(main, { mode: 'managed' });
  git(main, 'add', '.');
  git(main, 'commit', '-qm', 'init');
  wtB = join(base, 'wt-b');
  git(main, 'worktree', 'add', '-q', '-b', 'feature-b', wtB);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('PreToolUse — managed mode', () => {
  it('A: reads, discussion and external scratch writes never create a mission', async () => {
    for (const input of [
      { tool_name: 'Read', tool_input: { file_path: join(main, 'x') } },
      { tool_name: 'Grep', tool_input: { pattern: 'x' } },
      { tool_name: 'Bash', tool_input: { command: 'git status' } },
      { tool_name: 'Bash', tool_input: { command: 'ls -la | wc -l' } },
      { tool_name: 'Bash', tool_input: { command: 'monolith mission list' } },
      { tool_name: 'mcp__x__y', tool_input: {} },
      { tool_name: 'Write', tool_input: { file_path: join(base, 'scratch.txt'), content: 'x' } },
    ]) {
      expect(await handlePreToolUse({ session_id: 's', cwd: main, ...input })).toBeNull();
    }
    expect(await missions(main)).toEqual([]);
    expect(existsSync(resolveStateLocation(main).statePath)).toBe(false);
  });

  it('B+C: the first write enrols a mission and tells the agent its id; later writes reuse it silently', async () => {
    const first = (await handlePreToolUse(write(main, 'a.ts'))) as { hookSpecificOutput: { additionalContext: string; permissionDecision?: string } };
    expect(first.hookSpecificOutput.additionalContext).toContain('MIS-0001');
    expect(first.hookSpecificOutput.permissionDecision).toBeUndefined(); // never "allow": the host's permission flow is untouched
    expect(await handlePreToolUse(write(main, 'b.ts'))).toBeNull();
    expect(await handlePreToolUse({ ...write(main, 'c.ts'), tool_name: 'Edit', tool_input: { file_path: join(main, 'c.ts'), old_string: 'a', new_string: 'b' } })).toBeNull();
    expect(await handlePreToolUse({ session_id: 's1', cwd: main, tool_name: 'Bash', tool_input: { command: 'npm test' } })).toBeNull();
    expect((await missions(main)).map((m) => m.id)).toEqual(['MIS-0001']);
  });

  it('D: a restarted session resumes the same mission and is told so', async () => {
    await handlePreToolUse(write(main, 'a.ts', 'old'));
    const r = (await handlePreToolUse(write(main, 'b.ts', 'new'))) as { hookSpecificOutput: { additionalContext: string } };
    expect(r.hookSpecificOutput.additionalContext).toContain('resumed mission MIS-0001');
    expect(await missions(main)).toHaveLength(1);
  });

  it('E: a second worktree gets its own mission', async () => {
    await handlePreToolUse(write(main, 'a.ts'));
    const b = (await handlePreToolUse(write(wtB, 'b.ts', 'sB'))) as { hookSpecificOutput: { additionalContext: string } };
    expect(b.hookSpecificOutput.additionalContext).toContain('MIS-0002');
  });

  it('J: enrolment failure denies the controlled write (fail closed) — and only that', async () => {
    const loc = resolveStateLocation(main);
    mkdirSync(loc.stateDir, { recursive: true });
    writeFileSync(loc.statePath, '{ corrupt');
    const denied = (await handlePreToolUse(write(main, 'a.ts'))) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    expect(denied.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(denied.hookSpecificOutput.permissionDecisionReason).toContain('could not be enrolled');
    expect(await handlePreToolUse({ session_id: 's', cwd: main, tool_name: 'Read', tool_input: {} })).toBeNull(); // reading is not blocked
    expect(readFileSync(loc.statePath, 'utf8')).toBe('{ corrupt'); // state untouched
  });

  it('J: onEnrollmentFailure "allow" proceeds with a visible, honest warning', async () => {
    setMode(main, { mode: 'managed', onEnrollmentFailure: 'allow' });
    const loc = resolveStateLocation(main);
    mkdirSync(loc.stateDir, { recursive: true });
    writeFileSync(loc.statePath, '{ corrupt');
    const r = (await handlePreToolUse(write(main, 'a.ts'))) as { systemMessage: string; hookSpecificOutput?: unknown };
    expect(r.systemMessage).toContain('NOT tracked');
    expect(r.hookSpecificOutput).toBeUndefined();
  });

  it('an ambiguous context (CONFLICT) denies instead of picking a mission', async () => {
    const { enrollMission } = await import('../coordinatorium/enrollment.js');
    const { deriveExecutionContext } = await import('../coordinatorium/context.js');
    const { stateWriteTargetOf } = await import('../coordinatorium/state-location.js');
    const t = stateWriteTargetOf(resolveStateLocation(main));
    await enrollMission(t, deriveExecutionContext(main, { agent: 'claude-code', source: 't', storyId: 'S-1' }));
    // a second active mission for the same context can only exist through an explicit story choice
    const c2 = await enrollMission(t, deriveExecutionContext(main, { agent: 'claude-code', source: 't', storyId: 'S-2' }));
    expect(c2.status).toBe('CONFLICT');
    // the hook (no story) still has exactly one candidate -> reuse, never a silent second mission
    expect(await handlePreToolUse(write(main, 'a.ts'))).toBeNull();
    expect(await missions(main)).toHaveLength(1);
  });
});

describe('PreToolUse — unmanaged and misconfigured', () => {
  it('unmanaged (no execution key): silent no-op even for writes; nothing is created', async () => {
    rmSync(join(main, 'monolith.config.json'));
    expect(await handlePreToolUse(write(main, 'a.ts'))).toBeNull();
    expect(await missions(main)).toEqual([]);
  });

  it('a broken config is reported, not treated as managed and not silently ignored', async () => {
    writeFileSync(join(main, 'monolith.config.json'), '{oops');
    const r = (await handlePreToolUse(write(main, 'a.ts'))) as { systemMessage: string };
    expect(r.systemMessage).toContain('NOT governed');
  });
});

describe('I: honest enforcement status', () => {
  it('managed config without the hook is "not confirmed", never "working"', () => {
    const st = buildExecutionStatus(main);
    expect(st.enforcement).toBe('configured-hook-not-found');
    expect(st.summary).toContain('NOT CONFIRMED');
  });

  it('finds the hook in project settings; off mode says so', () => {
    mkdirSync(join(main, '.claude'));
    writeFileSync(join(main, '.claude', 'settings.json'), hookConfigSnippet(true));
    expect(buildExecutionStatus(main)).toMatchObject({ enforcement: 'configured-hook-found', hook: { installation: 'found' } });
    setMode(main, { mode: 'off' });
    expect(buildExecutionStatus(main).enforcement).toBe('inactive-off');
  });

  it('session-start reports ownership and other contexts, and writes nothing', async () => {
    await handlePreToolUse(write(main, 'a.ts'));
    const lines = (await buildExecutionLines({ cwd: wtB, session_id: 'sB' }, wtB)).join('\n');
    expect(lines).toContain('No mission is registered for this worktree yet');
    expect(lines).toContain('Active mission of another context: MIS-0001');
    expect(lines).toContain('UNKNOWN');
    expect(await missions(main)).toHaveLength(1);
  });
});

describe('config snippet', () => {
  it('default snippet is unchanged (no PreToolUse); --managed adds a fail-closed PreToolUse hook', () => {
    expect(JSON.parse(hookConfigSnippet()).hooks.PreToolUse).toBeUndefined();
    const m = JSON.parse(hookConfigSnippet(true)).hooks.PreToolUse[0];
    expect(m.matcher).toBe('Write|Edit|MultiEdit|NotebookEdit|Bash');
    expect(m.hooks[0].command).toContain('exit 2');
    expect(m.hooks[0].command).toContain('monolith hook pre-tool-use');
  });
});

describe('classification (conservative, no shell parser)', () => {
  const cmd = (c: string) => classifyBashCommand(c).action;
  it('read-only simple commands and pipelines', () => {
    for (const c of ['ls', 'git status', 'git log --oneline', 'cat README.md', 'grep -rn foo src', 'git diff HEAD | head', 'find . -name x']) expect(cmd(c)).toBe('read');
  });
  it('anything else is implementation', () => {
    for (const c of ['rm -rf x', 'npm test', 'echo hi > f', 'cat a > b', 'git commit -m x', 'git diff --output=f', 'find . -delete', 'ls && rm x', 'FOO=1 ls', 'sed -i s/a/b/ f', 'cat $(rm x)', 'ls | tee f', 'git status; rm x', 'ls "a b"']) expect(cmd(c)).toBe('implementation');
  });
  it('monolith CLI is governed, only as a single command', () => {
    expect(cmd('monolith mission start --title t --system s')).toBe('governed');
    expect(cmd('monolith mission list && rm -rf x')).toBe('implementation');
  });
  it('file tools: inside the worktree = implementation; outside = external; symlink escape resolved', () => {
    expect(classifyToolUse('Edit', { file_path: 'src/a.ts' }, main, main).action).toBe('implementation');
    expect(classifyToolUse('Write', { file_path: join(base, 'o.txt') }, main, main).action).toBe('external');
    expect(classifyToolUse('Write', { file_path: '../o.txt' }, main, main).action).toBe('external');
    expect(classifyToolUse('Write', {}, main, main).action).toBe('implementation');
    expect(classifyToolUse('NotebookEdit', { notebook_path: join(main, 'n.ipynb') }, main, main).action).toBe('implementation');
  });
  it('unknown tools are "uncontrolled" (not claimed as covered)', () => {
    expect(classifyToolUse('mcp__x__write', {}, main, main).action).toBe('uncontrolled');
    chmodSync(main, 0o755);
  });
});
