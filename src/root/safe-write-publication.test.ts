import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SafeWriteError, createExclusive, createFile, openParent, projectBoundary, replaceFile } from './index.js';
import { publishLink, realFsOps, type FsOps } from './safe-write.js';

// SEC-001B.2 review F-01 / F-02: no errno is proof that a publish call had no
// effect, and a link count is not proof that a link is ours. Every decision
// comes from the identity (dev/ino) of the destination and of the temp name.
let base: string;
let project: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'monolith-pub-'));
  project = join(base, 'project');
  mkdirSync(project);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const OPTS = { mode: 0o600 } as const;

function errno(code: string): NodeJS.ErrnoException {
  const e = new Error(`injected ${code}`) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

function parent() {
  return openParent(projectBoundary(project), project);
}

function counted<K extends keyof FsOps>(name: K, impl: FsOps[K]): { fn: FsOps[K]; calls: () => number } {
  let n = 0;
  const fn = ((...a: unknown[]) => {
    n++;
    return (impl as unknown as (...x: unknown[]) => unknown)(...a);
  }) as unknown as FsOps[K];
  return { fn, calls: () => n };
}

function caught(fn: () => unknown): SafeWriteError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(SafeWriteError);
    return err as SafeWriteError;
  }
  throw new Error('expected SafeWriteError');
}

const tmpNames = (): string[] => readdirSync(project).filter((n) => /\.tmp\./.test(n));

// The former allowlist: errors that used to be taken as "the destination is untouched".
const FORMER_ALLOWLIST = [
  'EACCES', 'EPERM', 'EROFS', 'ENOENT', 'ENOTDIR', 'EISDIR', 'EXDEV', 'EBUSY',
  'ETXTBSY', 'ELOOP', 'ENAMETOOLONG', 'EINVAL', 'EMLINK', 'ENOSPC', 'EDQUOT', 'ENOTEMPTY',
];

describe('F-01 rename: an error is not evidence of "not published"', () => {
  beforeEach(() => writeFileSync(join(project, 'state.json'), 'OLD'));

  it.each(FORMER_ALLOWLIST)('%s reported AFTER the rename took effect -> PUBLISHED with a warning, one rename, no temp left', (code) => {
    const r = counted('renameSync', ((a: string, b: string) => {
      renameSync(a, b);
      throw errno(code);
    }) as FsOps['renameSync']);
    const out = replaceFile(parent(), 'state.json', 'NEW', { ...OPTS, ops: { renameSync: r.fn } });
    expect(out.publication).toBe('PUBLISHED');
    expect(out.warnings.map((w) => w.code)).toContain('PUBLICATION_VERIFIED_AFTER_ERROR');
    expect(r.calls()).toBe(1);
    expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('NEW');
    expect(tmpNames()).toEqual([]);
  });

  it.each(FORMER_ALLOWLIST)('%s when nothing happened -> NOT_PUBLISHED (proved by the temp name still being ours), temp removed', (code) => {
    const r = counted('renameSync', (() => {
      throw errno(code);
    }) as unknown as FsOps['renameSync']);
    const e = caught(() => replaceFile(parent(), 'state.json', 'NEW', { ...OPTS, ops: { renameSync: r.fn } }));
    expect(e.publication).toBe('NOT_PUBLISHED');
    expect(e.tmp).toMatchObject({ owned: true, removed: true });
    expect(r.calls()).toBe(1);
    expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('OLD');
    expect(tmpNames()).toEqual([]);
  });

  it.each(['ENOENT', 'EBUSY', 'EACCES'])('%s with an inspection that fails -> UNKNOWN, never retried, nothing deleted', (code) => {
    const r = counted('renameSync', (() => {
      throw errno(code);
    }) as unknown as FsOps['renameSync']);
    const u = counted('unlinkSync', realFsOps.unlinkSync);
    const lstat = ((p: string, o?: unknown) => {
      if (r.calls() > 0) throw errno('EIO');
      return realFsOps.lstatSync(p, o as never);
    }) as unknown as FsOps['lstatSync'];
    const e = caught(() => replaceFile(parent(), 'state.json', 'NEW', { ...OPTS, ops: { renameSync: r.fn, unlinkSync: u.fn, lstatSync: lstat } }));
    expect(e.publication).toBe('UNKNOWN');
    expect(e.code).toBe('WRITE_PUBLICATION_UNKNOWN');
    expect(r.calls()).toBe(1);
    expect(u.calls()).toBe(0);
    expect(tmpNames().length).toBe(1);
  });

  it('ENOENT with the temp name gone and the destination not ours -> UNKNOWN (not "not modified")', () => {
    const e = caught(() =>
      replaceFile(parent(), 'state.json', 'NEW', {
        ...OPTS,
        ops: {
          renameSync: ((a: string) => {
            unlinkSync(a);
            throw errno('ENOENT');
          }) as FsOps['renameSync'],
        },
      }),
    );
    expect(e.publication).toBe('UNKNOWN');
    expect(e.tmp).toMatchObject({ owned: true, removed: false });
    expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('OLD');
  });

  it('a foreign file under the temp name is never removed when ownership cannot be shown', () => {
    const u = counted('unlinkSync', realFsOps.unlinkSync);
    let foreign = '';
    const e = caught(() =>
      replaceFile(parent(), 'state.json', 'NEW', {
        ...OPTS,
        ops: {
          unlinkSync: u.fn,
          renameSync: ((a: string) => {
            foreign = a;
            realFsOps.unlinkSync(a);
            writeFileSync(a, 'FOREIGN');
            throw errno('EBUSY');
          }) as FsOps['renameSync'],
        },
      }),
    );
    expect(e.publication).toBe('UNKNOWN');
    expect(u.calls()).toBe(0);
    expect(readFileSync(foreign, 'utf8')).toBe('FOREIGN');
  });
});

describe('F-01 link: an error is not evidence of "not published"', () => {
  it.each(FORMER_ALLOWLIST)('%s reported AFTER the link took effect -> PUBLISHED with a warning, one link, the second name removed', (code) => {
    const l = counted('linkSync', ((a: string, b: string) => {
      linkSync(a, b);
      throw errno(code);
    }) as FsOps['linkSync']);
    const out = createFile(parent(), 'n.txt', 'mine', { ...OPTS, ops: { linkSync: l.fn } });
    expect(out.publication).toBe('PUBLISHED');
    expect(out.warnings.map((w) => w.code)).toContain('PUBLICATION_VERIFIED_AFTER_ERROR');
    expect(l.calls()).toBe(1);
    expect(readFileSync(join(project, 'n.txt'), 'utf8')).toBe('mine');
    expect(lstatSync(join(project, 'n.txt')).nlink).toBe(1);
  });

  it.each(FORMER_ALLOWLIST)('%s when nothing happened -> NOT_PUBLISHED, destination absent, temp removed', (code) => {
    const e = caught(() =>
      createFile(parent(), 'n.txt', 'mine', {
        ...OPTS,
        ops: {
          linkSync: (() => {
            throw errno(code);
          }) as unknown as FsOps['linkSync'],
        },
      }),
    );
    expect(e.publication).toBe('NOT_PUBLISHED');
    expect(e.code).toBe(code === 'EPERM' || code === 'EXDEV' ? 'WRITE_LINK_UNSUPPORTED' : e.code);
    expect(readdirSync(project)).toEqual([]);
  });

  it('EPERM that did take effect is PUBLISHED, not "hard links unsupported"', () => {
    const out = createFile(parent(), 'n.txt', 'mine', {
      ...OPTS,
      ops: {
        linkSync: ((a: string, b: string) => {
          linkSync(a, b);
          throw errno('EPERM');
        }) as FsOps['linkSync'],
      },
    });
    expect(out.publication).toBe('PUBLISHED');
  });
});

describe('F-02 link + EEXIST: the identity of the destination decides, not the link count', () => {
  /** Foreign file at the destination AND a second hard link to our temp name. */
  const hostile = ((a: string, b: string) => {
    writeFileSync(b, 'FOREIGN');
    linkSync(a, join(project, 'extra-link'));
    throw errno('EEXIST');
  }) as FsOps['linkSync'];

  it('staging has nlink 2 but the destination is a foreign inode -> NOT published (createFile)', () => {
    const e = caught(() => createFile(parent(), 'n.txt', 'mine', { ...OPTS, ops: { linkSync: hostile } }));
    expect(e.publication).toBe('NOT_PUBLISHED');
    expect(e.code).toBe('WRITE_TARGET_EXISTS');
    expect(readFileSync(join(project, 'n.txt'), 'utf8')).toBe('FOREIGN');
  });

  it('same situation at the lock-facing primitive: publishLink reports lost-race, not published', () => {
    const p = parent();
    const owned = createExclusive(p, 'n.txt.creating.1.x', 0o600);
    realFsOps.closeSync(owned.fd);
    const res = publishLink(p, owned.token, 'n.txt', { ops: { linkSync: hostile } });
    expect(res.outcome).toBe('lost-race');
    expect(res.warnings).toEqual([]);
    expect(readFileSync(join(project, 'n.txt'), 'utf8')).toBe('FOREIGN');
  });

  it('EEXIST with the destination being OUR inode is PUBLISHED even if other names exist', () => {
    const out = createFile(parent(), 'n.txt', 'mine', {
      ...OPTS,
      ops: {
        linkSync: ((a: string, b: string) => {
          linkSync(a, b);
          throw errno('EEXIST');
        }) as FsOps['linkSync'],
      },
    });
    expect(out.warnings.map((w) => w.code)).toContain('PUBLICATION_VERIFIED_AFTER_ERROR');
  });

  it('EEXIST, destination vanished again and our link count is 2 -> UNKNOWN (cannot tell), never published', () => {
    const e = caught(() =>
      createFile(parent(), 'n.txt', 'mine', {
        ...OPTS,
        ops: {
          linkSync: ((a: string) => {
            linkSync(a, join(project, 'extra-link'));
            throw errno('EEXIST');
          }) as FsOps['linkSync'],
        },
      }),
    );
    expect(e.publication).toBe('UNKNOWN');
  });

  it('EEXIST on a special object (symlink) at the destination is a lost race', () => {
    const p = parent();
    const owned = createExclusive(p, 'n.txt.creating.1.y', 0o600);
    realFsOps.closeSync(owned.fd);
    const res = publishLink(p, owned.token, 'n.txt', {
      ops: {
        linkSync: ((_a: string, b: string) => {
          symlinkSync(join(base, 'nowhere'), b);
          throw errno('EEXIST');
        }) as FsOps['linkSync'],
      },
    });
    expect(res.outcome).toBe('lost-race');
  });
});
