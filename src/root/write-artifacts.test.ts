import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describeWriteArtifacts, findWriteArtifacts } from './index.js';
import { collect } from '../brief/collect.js';
import { render } from '../brief/render.js';
import { scaffoldInstance } from '../init/scaffold.js';
import { runValidate } from '../validate/index.js';

// SEC-001B.2 / DEC-B2-02: leftover write files are only REPORTED. Names alone
// prove nothing about ownership, so nothing is ever opened, repaired or deleted.
let base: string;
let dir: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'monolith-art-'));
  dir = join(base, 'inst');
  mkdirSync(dir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
});

describe('findWriteArtifacts', () => {
  it('recognizes temp, lock-staging and recovery-mutex names, and ignores everything else', () => {
    for (const n of [
      'state.json.tmp.123.deadbeef',
      'state.json.lock.creating.123.abcd',
      'state.json.lock.recovery',
      'state.json.lock.recovery.creating.9.ff',
      'state.json',
      'state.json.lock',
      'state.json.bak',
      'notes.tmp.1',
      'state.json.tmpfile',
    ]) {
      writeFileSync(join(dir, n), 'x');
    }
    expect(findWriteArtifacts(dir)).toEqual([
      { name: 'state.json.lock.creating.123.abcd', kind: 'lock-staging' },
      { name: 'state.json.lock.recovery', kind: 'recovery-mutex' },
      { name: 'state.json.lock.recovery.creating.9.ff', kind: 'recovery-mutex' },
      { name: 'state.json.tmp.123.deadbeef', kind: 'state-temp' },
    ]);
  });

  it('is read-only: never opens, follows or deletes — a FIFO and a symlink with artifact names are only listed', () => {
    execFileSync('mkfifo', [join(dir, 'state.json.tmp.1.fifo')]);
    symlinkSync(join(base, 'does-not-exist'), join(dir, 'state.json.lock.creating.1.link'));
    writeFileSync(join(dir, 'state.json.tmp.2.file'), 'keep');
    const before = readdirSync(dir).sort();
    const found = findWriteArtifacts(dir);
    expect(found.map((a) => a.name)).toEqual(['state.json.lock.creating.1.link', 'state.json.tmp.1.fifo', 'state.json.tmp.2.file']);
    expect(readdirSync(dir).sort()).toEqual(before);
    expect(lstatSync(join(dir, 'state.json.tmp.1.fifo')).isFIFO()).toBe(true);
    expect(lstatSync(join(dir, 'state.json.lock.creating.1.link')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(dir, 'state.json.tmp.2.file'), 'utf8')).toBe('keep');
  });

  it('never throws: a missing or unreadable directory reports nothing', () => {
    expect(findWriteArtifacts(join(base, 'missing'))).toEqual([]);
    writeFileSync(join(base, 'file'), 'x');
    expect(findWriteArtifacts(join(base, 'file'))).toEqual([]);
  });

  it('the description is bounded, says the files may be in use, and escapes hostile names', () => {
    const artifacts = Array.from({ length: 6 }, (_, i) => ({ name: `state.json.tmp.${i}`, kind: 'state-temp' as const }));
    artifacts.push({ name: 'state.json.tmp.\n[ERROR] forged', kind: 'state-temp' });
    const text = describeWriteArtifacts(artifacts, '.monolith');
    expect(text).toMatch(/may belong to a command that is still running/);
    expect(text).toMatch(/never deletes/);
    expect(text).toMatch(/and 4 more/);
    expect(text).not.toMatch(/\n/);
  });
});

describe('brief and validate report leftovers without changing their verdict', () => {
  async function scaffolded(): Promise<string> {
    const project = join(base, 'project');
    mkdirSync(project);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await scaffoldInstance(project, {
      projectName: 'p',
      language: 'typescript',
      packageManager: 'pnpm',
      aiTool: 'claude',
      finalizationProtocol: 'finalize-story',
      protocols: ['finalize-story'],
      monolithRoot: '.monolith',
    });
    return project;
  }

  it('brief: a warning diagnostic appears, Completeness is unchanged, nothing is deleted', async () => {
    const project = await scaffolded();
    const baseline = render(await collect(project), 6000);
    expect(baseline.text).not.toMatch(/WRITE_ARTIFACTS_PRESENT/);

    const leftover = join(project, '.monolith', 'state.json.tmp.77.cafe');
    writeFileSync(leftover, 'half-written');
    const model = await collect(project);
    const d = model.diagnostics.find((x) => x.code === 'WRITE_ARTIFACTS_PRESENT');
    expect(d?.severity).toBe('warn');
    const after = render(model, 6000);
    expect(after.text).toMatch(/\[WARN\] WRITE_ARTIFACTS_PRESENT/);
    expect(after.completeness).toBe(baseline.completeness); // a warning never makes the brief INCOMPLETE
    expect(existsSync(leftover)).toBe(true);
    expect(readFileSync(leftover, 'utf8')).toBe('half-written');
  });

  it('validate: prints a warning line, still PASS with exit code 0, deletes nothing', async () => {
    const project = await scaffolded();
    writeFileSync(join(project, '.monolith', 'state.json.lock.recovery'), 'x');
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
    let code: number | undefined;
    const exit = vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c;
      throw new Error('__exit__');
    }) as never);
    await runValidate({ targetDir: project, quiet: false }).catch((e: unknown) => {
      if (!(e instanceof Error) || e.message !== '__exit__') throw e;
    });
    exit.mockRestore();
    expect(code).toBe(0);
    expect(lines.join('\n')).toMatch(/Result: PASS/);
    expect(lines.join('\n')).toMatch(/Warning: 1 leftover-looking write file\(s\)/);
    expect(existsSync(join(project, '.monolith', 'state.json.lock.recovery'))).toBe(true);
  });
});
