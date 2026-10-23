import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readState, stateFilePath } from './state-keeper.js';
import { createInitialState } from './types.js';

// SEC-001B.1-R, finding L-2: a read target is validated BEFORE any filesystem operation. A relative
// or empty path, a dangling symlink or an unusable boundary must never come back as the empty state
// ("no missions ever recorded"); only a genuinely absent, valid directory may.

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'monolith-l2-'));
  dirs.push(d);
  return d;
}

async function rejection(p: Promise<unknown>): Promise<{ fileCode?: string; message: string }> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, 'expected the read to be refused').not.toBeNull();
  return err as { fileCode?: string; message: string };
}

describe('L-2 — trusted-directory read target', () => {
  it('a relative stateDir is READ_BOUNDARY_INVALID, never the empty state (even if the relative dir does not exist)', async () => {
    const e = await rejection(readState({ scope: 'trusted-directory', stateDir: 'no/such/relative/dir' }));
    expect(e.fileCode).toBe('READ_BOUNDARY_INVALID');
  });

  it('a relative stateDir that exists relative to the cwd is refused as well (the cwd is never a boundary)', async () => {
    const base = tmp();
    mkdirSync(join(base, 'rel'));
    const prev = process.cwd();
    process.chdir(base);
    try {
      const e = await rejection(readState({ scope: 'trusted-directory', stateDir: 'rel' }));
      expect(e.fileCode).toBe('READ_BOUNDARY_INVALID');
    } finally {
      process.chdir(prev);
    }
  });

  it('an empty stateDir is READ_BOUNDARY_INVALID', async () => {
    const e = await rejection(readState({ scope: 'trusted-directory', stateDir: '' }));
    expect(e.fileCode).toBe('READ_BOUNDARY_INVALID');
  });

  it('a non-string stateDir is READ_BOUNDARY_INVALID', async () => {
    for (const bad of [undefined, null, 42, {}]) {
      const e = await rejection(readState({ scope: 'trusted-directory', stateDir: bad } as never));
      expect(e.fileCode, String(bad)).toBe('READ_BOUNDARY_INVALID');
    }
  });

  it('a dangling symlink as stateDir is refused, not the empty state', async () => {
    const base = tmp();
    const link = join(base, 'state-dir');
    symlinkSync(join(base, 'nowhere'), link);
    const e = await rejection(readState({ scope: 'trusted-directory', stateDir: link }));
    expect(e.fileCode).toBe('READ_BOUNDARY_INVALID');
  });

  it('a symlink loop as stateDir is refused', async () => {
    const base = tmp();
    const link = join(base, 'loop');
    symlinkSync(link, link);
    const e = await rejection(readState({ scope: 'trusted-directory', stateDir: link }));
    expect(e.fileCode).toBe('READ_BOUNDARY_INVALID');
  });

  it('stateDir that is a regular file (not a directory) is refused', async () => {
    const base = tmp();
    const file = join(base, 'file');
    writeFileSync(file, 'x');
    const e = await rejection(readState({ scope: 'trusted-directory', stateDir: file }));
    expect(e.fileCode).toBe('READ_BOUNDARY_INVALID');
  });

  it('a genuinely absent absolute directory still holds no state (contract kept)', async () => {
    const base = tmp();
    const state = await readState({ scope: 'trusted-directory', stateDir: join(base, 'not-created-yet') });
    expect(state).toEqual(createInitialState());
  });

  it('an existing directory without state.json holds no state (contract kept)', async () => {
    const base = tmp();
    expect(await readState({ scope: 'trusted-directory', stateDir: base })).toEqual(createInitialState());
  });

  it('a normalisable but non-canonical absolute path (with ..) is accepted when it resolves to a real directory', async () => {
    const base = tmp();
    mkdirSync(join(base, 'a'));
    expect(await readState({ scope: 'trusted-directory', stateDir: join(base, 'a', '..', 'a') })).toEqual(createInitialState());
  });
});

describe('L-2 — project read target', () => {
  it('a relative projectRoot is READ_BOUNDARY_INVALID', async () => {
    const base = tmp();
    const e = await rejection(readState({ scope: 'project', projectRoot: 'relative', stateDir: join(base, '.monolith') }));
    expect(e.fileCode).toBe('READ_BOUNDARY_INVALID');
  });

  it('a relative stateDir is READ_BOUNDARY_INVALID', async () => {
    const base = tmp();
    const e = await rejection(readState({ scope: 'project', projectRoot: base, stateDir: '.monolith' }));
    expect(e.fileCode).toBe('READ_BOUNDARY_INVALID');
  });

  it('a projectRoot that does not exist is refused (a missing boundary is not "no state")', async () => {
    const base = tmp();
    const e = await rejection(
      readState({ scope: 'project', projectRoot: join(base, 'gone'), stateDir: join(base, 'gone', '.monolith') }),
    );
    expect(e.fileCode).toBe('READ_BOUNDARY_INVALID');
  });

  it('a stateDir outside the projectRoot is refused', async () => {
    const base = tmp();
    mkdirSync(join(base, 'proj'));
    mkdirSync(join(base, 'other'));
    const e = await rejection(readState({ scope: 'project', projectRoot: join(base, 'proj'), stateDir: join(base, 'other') }));
    expect(e.fileCode).toBe('FILE_OUTSIDE_PROJECT');
  });

  it('a valid project whose instance directory is absent still holds no state (contract kept)', async () => {
    const base = tmp();
    const state = await readState({ scope: 'project', projectRoot: base, stateDir: join(base, '.monolith') });
    expect(state).toEqual(createInitialState());
    expect(stateFilePath(join(base, '.monolith'))).toContain('state.json');
  });
});
