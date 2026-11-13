import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findDrift, parsePorcelainZ } from './check-build-integrity.mjs';
import { htmlAssetRefs, validatePack } from './validate-package.mjs';

describe('Build Integrity Gate', () => {
  let repo;
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  const put = (p, c) => {
    mkdirSync(join(repo, p, '..'), { recursive: true });
    writeFileSync(join(repo, p), c);
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'monolith-gate-'));
    git('init', '-q');
    put('dist/a.js', 'a');
    put('dist/ui/assets/index-OLD.js', 'old');
    put('src/x.ts', 'x');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('passes when dist matches HEAD', () => {
    expect(findDrift(repo)).toEqual([]);
  });
  it('detects a modified tracked artifact', () => {
    put('dist/a.js', 'changed');
    expect(findDrift(repo)).toEqual([{ code: 'M', path: 'dist/a.js' }]);
  });
  it('detects a deleted tracked artifact (stale bundle)', () => {
    unlinkSync(join(repo, 'dist/ui/assets/index-OLD.js'));
    expect(findDrift(repo)).toEqual([{ code: 'D', path: 'dist/ui/assets/index-OLD.js' }]);
  });
  it('detects a new untracked artifact, including in new subdirectories', () => {
    put('dist/new/deep/b.js', 'b');
    expect(findDrift(repo)).toEqual([{ code: '??', path: 'dist/new/deep/b.js' }]);
  });
  it('detects staged drift', () => {
    put('dist/a.js', 'staged');
    git('add', 'dist/a.js');
    expect(findDrift(repo)).toHaveLength(1);
  });
  it('ignores changes outside dist/', () => {
    put('src/x.ts', 'edited');
    expect(findDrift(repo)).toEqual([]);
  });
  it('parses rename records without misreading the origin path', () => {
    expect(parsePorcelainZ('R  new.js\0old.js\0 M b.js\0')).toEqual([
      { code: 'R', path: 'new.js' },
      { code: 'M', path: 'b.js' },
    ]);
  });
});

describe('Package Validation', () => {
  const pkg = { main: 'dist/index.js', types: 'dist/index.d.ts', bin: { monolith: 'dist/cli/index.js' } };
  const good = [
    'package.json', 'README.md', 'LICENSE',
    'dist/index.js', 'dist/index.d.ts', 'dist/cli/index.js',
    'dist/readmodel/roadmap.js', 'dist/readmodel/roadmap.d.ts',
    'dist/readmodel/dashboard.js', 'dist/readmodel/types.d.ts',
    'dist/ui/index.html', 'dist/ui/assets/index-NEW.js', 'dist/ui/assets/index-NEW.css',
    'templates/x.md',
  ];
  const html = '<script src="./assets/index-NEW.js"></script><link href="./assets/index-NEW.css">';
  const run = (files) =>
    validatePack({ files, pkg, readFile: (p) => (p === 'dist/ui/index.html' ? html : 'plain text') });

  it('accepts a correct package', () => expect(run(good)).toEqual([]));
  it('parses html asset refs', () => expect([...htmlAssetRefs(html)]).toEqual(['assets/index-NEW.js', 'assets/index-NEW.css']));
  it('flags a missing required file', () =>
    expect(run(good.filter((f) => f !== 'dist/readmodel/roadmap.js')).join()).toContain('roadmap.js'));
  it('flags sources, tests, env files, logs and dev scripts', () => {
    const out = run([...good, 'src/a.ts', 'dist/a.test.js', '.env', 'debug.log', 'dist/scripts/x.js']).join('\n');
    for (const f of ['src/a.ts', 'dist/a.test.js', '.env', 'debug.log', 'dist/scripts/x.js']) expect(out).toContain(f);
  });
  it('flags a stale UI bundle', () =>
    expect(run([...good, 'dist/ui/assets/index-OLD.js']).join()).toContain('stale UI bundle'));
  it('flags index.html referencing a missing asset', () =>
    expect(run(good.filter((f) => f !== 'dist/ui/assets/index-NEW.css')).join()).toContain('references a file not in package'));
  it('flags a bin target absent from the package', () =>
    expect(run(good.filter((f) => f !== 'dist/cli/index.js')).join()).toContain('entry point'));
  it('flags embedded secrets', () => {
    const out = validatePack({
      files: good,
      pkg,
      readFile: (p) => (p === 'dist/ui/index.html' ? html : p === 'dist/index.js' ? '-----BEGIN RSA PRIVATE KEY-----' : 'x'),
    });
    expect(out.join()).toContain('private key');
  });
});
