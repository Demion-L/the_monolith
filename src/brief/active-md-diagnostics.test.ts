import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { collect, MAX_ACTIVE_CONTEXT_BYTES } from './collect.js';
import { render } from './render.js';
import { ACTIVE_MD_REL } from './constants.js';

// SEC-001B.1-R, finding M-1: a security rejection of active.md must not be reported as "the file is
// missing". Three situations are kept apart, each with a typed `readCode`:
//   1. the file is really absent            -> ACTIVE_MD_MISSING   (warn,  COMPLETE)
//   2. present but refused by the policy    -> ACTIVE_MD_REJECTED  (error, INCOMPLETE)
//   3. present, another read failure        -> ACTIVE_MD_UNREADABLE (error, INCOMPLETE)
// The content of a refused file never reaches the brief.

const SECRET = 'PRIVATE-FILE-CONTENT-7be1';
const REPO = resolve(__dirname, '..', '..');
const TSC = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');

const dirs: string[] = [];
let compiledCli: string;

function tmp(prefix = 'monolith-m1-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function project() {
  const base = tmp();
  const proj = join(base, 'project');
  const mon = join(proj, '.monolith');
  mkdirSync(join(mon, 'memory', 'working'), { recursive: true });
  mkdirSync(join(proj, 'private'));
  writeFileSync(join(proj, 'monolith.config.json'), JSON.stringify({ monolithRoot: '.monolith' }));
  writeFileSync(join(proj, 'private', 'notes.md'), `## Current Story\n\n${SECRET}\n`);
  return { proj, mon, active: join(mon, 'memory', 'working', 'active.md'), priv: join(proj, 'private', 'notes.md') };
}

function strictBrief(cwd: string): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [compiledCli, 'brief', '--strict'], { cwd, encoding: 'utf8', timeout: 15_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

beforeAll(() => {
  const outDir = tmp('monolith-m1-build-');
  execFileSync(
    process.execPath,
    [TSC, '-p', join(REPO, 'tsconfig.json'), '--outDir', outDir, '--tsBuildInfoFile', join(outDir, 'tsbuildinfo')],
    { cwd: REPO, stdio: 'pipe' },
  );
  compiledCli = join(outDir, 'cli', 'index.js');
}, 120_000);

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function activeDiagnostics(model: Awaited<ReturnType<typeof collect>>) {
  return model.diagnostics.filter((d) => d.code.startsWith('ACTIVE_MD_') || d.code === 'PATH_OUTSIDE_PROJECT');
}

describe('M-1 — active.md: missing vs. rejected vs. unreadable', () => {
  it('1. really absent: ACTIVE_MD_MISSING (warn) with readCode FILE_MISSING; the brief stays COMPLETE', async () => {
    const p = project();
    const model = await collect(p.proj);
    const d = activeDiagnostics(model);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ code: 'ACTIVE_MD_MISSING', severity: 'warn', readCode: 'FILE_MISSING' });
    expect(render(model).completeness).toBe('COMPLETE');
    const r = strictBrief(p.proj);
    expect(r.code).toBe(0);
  });

  describe('2. present but refused by the security policy', () => {
    const cases: Array<[string, string, (p: ReturnType<typeof project>) => void]> = [
      ['FILE_SYMLINK (in-project symlink)', 'FILE_SYMLINK', (p) => symlinkSync(p.priv, p.active)],
      [
        'symlink pointing outside the project (caught first by the containment pre-check)',
        'PATH_OUTSIDE_PROJECT',
        (p) => {
          const outside = join(tmp(), 'outside.md');
          writeFileSync(outside, `## Current Story\n\n${SECRET}\n`);
          symlinkSync(outside, p.active);
        },
      ],
      ['FILE_HARDLINKED', 'FILE_HARDLINKED', (p) => linkSync(p.priv, p.active)],
      ['FILE_NOT_REGULAR (a directory)', 'FILE_NOT_REGULAR', (p) => mkdirSync(p.active)],
      [
        'FILE_NOT_REGULAR (a FIFO)',
        'FILE_NOT_REGULAR',
        (p) => {
          execFileSync('mkfifo', [p.active]);
        },
      ],
    ];

    for (const [name, code, arrange] of cases) {
      it(`${name}: rejected as an error (${code}), INCOMPLETE, no content leaked, --strict exits 2`, async () => {
        const p = project();
        arrange(p);
        const model = await collect(p.proj);
        const d = activeDiagnostics(model);
        expect(d).toHaveLength(1);
        if (code === 'PATH_OUTSIDE_PROJECT') {
          // Pre-existing SEC-001A diagnostic: already an error, carries its typed ROOT_* reason.
          expect(d[0]).toMatchObject({ code, severity: 'error' });
          expect(d[0].message).toMatch(/ROOT_[A-Z_]+/);
        } else {
          expect(d[0]).toMatchObject({ code: 'ACTIVE_MD_REJECTED', severity: 'error', readCode: code });
        }
        expect(model.diagnostics.map((x) => x.code)).not.toContain('ACTIVE_MD_MISSING');
        expect(model.story.excerpt).toBeNull();

        const rendered = render(model);
        expect(rendered.completeness).toBe('INCOMPLETE');
        expect(rendered.text).not.toContain(SECRET);
        expect(rendered.text).toMatch(/Completeness: INCOMPLETE/);
        expect(rendered.text).toMatch(code === 'PATH_OUTSIDE_PROJECT' ? /PATH_OUTSIDE_PROJECT/ : /ACTIVE_MD_REJECTED/);

        const r = strictBrief(p.proj);
        expect(r.code).toBe(2);
        expect(r.out).not.toContain(SECRET);
      });
    }

    it('a dangling symlink is a rejection, not "missing"', async () => {
      const p = project();
      symlinkSync(join(p.proj, 'nowhere.md'), p.active);
      const model = await collect(p.proj);
      const d = activeDiagnostics(model);
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({ severity: 'error' });
      expect(d[0].code).not.toBe('ACTIVE_MD_MISSING');
      expect(render(model).completeness).toBe('INCOMPLETE');
    });

    it('a symlinked directory above active.md is a rejection, not "missing"', async () => {
      const p = project();
      const real = join(p.mon, 'memory', 'real-working');
      mkdirSync(real);
      writeFileSync(join(real, 'active.md'), `## Current Story\n\n${SECRET}\n`);
      rmSync(join(p.mon, 'memory', 'working'), { recursive: true });
      symlinkSync(real, join(p.mon, 'memory', 'working'));
      const model = await collect(p.proj);
      const d = activeDiagnostics(model);
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({ severity: 'error' });
      expect(d[0].code).not.toBe('ACTIVE_MD_MISSING');
      expect(render(model).completeness).toBe('INCOMPLETE');
      expect(render(model).text).not.toContain(SECRET);
    });
  });

  describe('3. present, another read failure', () => {
    it('over the size limit: ACTIVE_MD_UNREADABLE (error), readCode FILE_TOO_LARGE, INCOMPLETE, --strict exits 2', async () => {
      const p = project();
      writeFileSync(p.active, '');
      truncateSync(p.active, MAX_ACTIVE_CONTEXT_BYTES + 1);
      const model = await collect(p.proj);
      const d = activeDiagnostics(model);
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({ code: 'ACTIVE_MD_UNREADABLE', severity: 'error', readCode: 'FILE_TOO_LARGE' });
      expect(render(model).completeness).toBe('INCOMPLETE');
      expect(strictBrief(p.proj).code).toBe(2);
    });

    it.skipIf(process.getuid?.() === 0)('permission denied: ACTIVE_MD_UNREADABLE (error), readCode FILE_UNREADABLE', async () => {
      const p = project();
      writeFileSync(p.active, `## Current Story\n\n${SECRET}\n`);
      chmodSync(p.active, 0o000);
      try {
        const model = await collect(p.proj);
        const d = activeDiagnostics(model);
        expect(d).toHaveLength(1);
        expect(d[0]).toMatchObject({ code: 'ACTIVE_MD_UNREADABLE', severity: 'error', readCode: 'FILE_UNREADABLE' });
        expect(render(model).completeness).toBe('INCOMPLETE');
        expect(render(model).text).not.toContain(SECRET);
      } finally {
        chmodSync(p.active, 0o600);
      }
    });
  });
});

describe('M-1 — other managed sources keep missing and rejection apart', () => {
  it('state.json: absent is info/absent; a symlink is STATE_UNREADABLE (error) with the typed code; --strict exits 2', async () => {
    const absent = project();
    const m1 = await collect(absent.proj);
    expect(m1.diagnostics.find((d) => d.code === 'STATE_NOT_INITIALIZED')).toMatchObject({ severity: 'info', readCode: 'FILE_MISSING' });

    const linked = project();
    symlinkSync(linked.priv, join(linked.mon, 'state.json'));
    const m2 = await collect(linked.proj);
    expect(m2.stateKeeper.status).toBe('unreadable');
    expect(m2.diagnostics.find((d) => d.code === 'STATE_UNREADABLE')).toMatchObject({ severity: 'error', readCode: 'FILE_SYMLINK' });
    expect(m2.diagnostics.map((d) => d.code)).not.toContain('STATE_NOT_INITIALIZED');
    expect(strictBrief(linked.proj).code).toBe(2);
  });

  it('a protocol/ADR document that is a symlink is not silently skipped as "missing"', async () => {
    const p = project();
    mkdirSync(join(p.mon, 'protocols'), { recursive: true });
    writeFileSync(join(p.mon, 'protocols', 'real.md'), `---\nid: p\nenforcement: mandatory\n---\n# P\n`);
    const model = await collect(p.proj);
    expect(model.diagnostics.filter((d) => d.code === 'DOC_FILE_UNREADABLE')).toHaveLength(0);
    // Hardlinked document: the reader refuses it; the brief must say so as an error.
    linkSync(p.priv, join(p.mon, 'protocols', 'hard.md'));
    const m2 = await collect(p.proj);
    expect(m2.diagnostics.find((d) => d.code === 'DOC_FILE_UNREADABLE')).toMatchObject({ severity: 'error', readCode: 'FILE_HARDLINKED' });
    expect(render(m2).completeness).toBe('INCOMPLETE');
  });

  it('a configured document directory that is a DANGLING symlink is an error, not an "absent directory"', async () => {
    const p = project();
    writeFileSync(
      join(p.proj, 'monolith.config.json'),
      JSON.stringify({ monolithRoot: '.monolith', contextGateway: { adrDirs: ['docs-adr'] } }),
    );
    symlinkSync(join(p.proj, 'does-not-exist'), join(p.proj, 'docs-adr'));
    const model = await collect(p.proj);
    const d = model.diagnostics.filter((x) => x.code === 'DOC_DIR_UNREADABLE' || x.code === 'DOC_DIR_OUTSIDE_PROJECT');
    expect(d.length).toBeGreaterThan(0);
    expect(d[0].severity).toBe('error');
    expect(render(model).completeness).toBe('INCOMPLETE');
  });

  it('a configured document directory that is really absent stays routine (no diagnostic)', async () => {
    const p = project();
    writeFileSync(
      join(p.proj, 'monolith.config.json'),
      JSON.stringify({ monolithRoot: '.monolith', contextGateway: { adrDirs: ['docs-adr'] } }),
    );
    const model = await collect(p.proj);
    expect(model.diagnostics.filter((x) => x.code.startsWith('DOC_DIR_'))).toHaveLength(0);
  });
});

describe('Active Story contract: <monolithRoot>/memory/working/active.md via ACTIVE_MD_REL', () => {
  it('ACTIVE_MD_REL is the one fixed relative path', () => {
    expect(ACTIVE_MD_REL).toBe('memory/working/active.md');
  });

  it('the story is read from <monolithRoot>/ACTIVE_MD_REL for the default and for a custom monolithRoot', async () => {
    const p = project();
    writeFileSync(p.active, '## Current Story\n\nDEFAULT-ROOT-STORY\n');
    const m1 = await collect(p.proj);
    expect(m1.story.excerpt).toBe('DEFAULT-ROOT-STORY');
    expect(m1.story.provenance?.source).toBe(`${join('.monolith', ACTIVE_MD_REL)}:3-3`);

    const custom = join(p.proj, 'custom-root');
    mkdirSync(join(custom, 'memory', 'working'), { recursive: true });
    writeFileSync(join(custom, ACTIVE_MD_REL), '## Current Story\n\nCUSTOM-ROOT-STORY\n');
    writeFileSync(join(p.proj, 'monolith.config.json'), JSON.stringify({ monolithRoot: 'custom-root' }));
    const m2 = await collect(p.proj);
    expect(m2.story.excerpt).toBe('CUSTOM-ROOT-STORY');
    expect(m2.story.provenance?.source).toBe(`${join('custom-root', ACTIVE_MD_REL)}:3-3`);
  });

  it('there is no alternative location: an active.md next to the instance root is ignored', async () => {
    const p = project();
    writeFileSync(join(p.proj, 'active.md'), '## Current Story\n\nWRONG-PLACE\n');
    const model = await collect(p.proj);
    expect(model.story.excerpt).toBeNull();
    expect(model.diagnostics.find((d) => d.code === 'ACTIVE_MD_MISSING')).toBeDefined();
  });
});
