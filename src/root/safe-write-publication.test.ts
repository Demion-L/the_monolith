import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, constants, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import ts from 'typescript';
import { tmpdir } from 'os';
import { join } from 'path';
import { SafeWriteError, createExclusive, createFile, openParent, projectBoundary, replaceFile } from './index.js';
import { disposeOwned, publishLink, realFsOps, type FsOps } from './safe-write.js';

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

// ALPHA4-SEC-SAFEWRITE-002: ABA hardening. The staging descriptor stays open
// until publication and cleanup are done, so ownership is shown against the
// LIVE inode (fstat(fd) vs lstat(name)), never against a remembered dev/ino.
describe('ABA hardening: ownership is shown by the live staging descriptor', () => {
  /** Tracks every descriptor opened through the injected ops and how often it was closed. */
  function tracker() {
    const opened: number[] = [];
    const closes = new Map<number, number>();
    const log: string[] = [];
    const ops = {
      openSync: ((p: string, f: number, m?: number) => {
        const fd = realFsOps.openSync(p, f, m);
        opened.push(fd); // the kernel may hand the same number out again after a close
        return fd;
      }) as FsOps['openSync'],
      closeSync: ((fd: number) => {
        closes.set(fd, (closes.get(fd) ?? 0) + 1);
        log.push('close');
        return realFsOps.closeSync(fd);
      }) as FsOps['closeSync'],
      unlinkSync: ((p: string) => {
        log.push('unlink');
        return realFsOps.unlinkSync(p);
      }) as FsOps['unlinkSync'],
    };
    /** Every open is matched by exactly one close per descriptor number: no leak, no double close. */
    const expectBalanced = (): void => {
      expect(opened.length).toBeGreaterThan(0);
      const opens = new Map<number, number>();
      for (const fd of opened) opens.set(fd, (opens.get(fd) ?? 0) + 1);
      for (const [fd, n] of opens) expect(closes.get(fd)).toBe(n);
      expect([...closes.keys()].every((fd) => opens.has(fd))).toBe(true);
    };
    return { ops, log, closes, opened, expectBalanced };
  }

  beforeEach(() => writeFileSync(join(project, 'state.json'), 'OLD'));

  it('deterministic: the descriptor is still open when ownership is checked and the temp name is removed', () => {
    const t = tracker();
    let openDuringChecks = false;
    let stagingFd = -1; // the IDENTITY descriptor (second open); the writing one is closed before publication
    let opens = 0;
    const fstat = ((fd: number, o?: unknown) => {
      // fstat on the identity descriptor made AFTER the failed rename: it must still be open.
      if (t.log.includes('rename-failed') && fd === stagingFd) openDuringChecks = !t.closes.has(fd);
      return realFsOps.fstatSync(fd, o as never);
    }) as unknown as FsOps['fstatSync'];
    const open = ((p: string, f: number, m?: number) => {
      const fd = t.ops.openSync(p, f, m);
      if (++opens === 2) stagingFd = fd;
      return fd;
    }) as FsOps['openSync'];
    const e = caught(() =>
      replaceFile(parent(), 'state.json', 'NEW', {
        ...OPTS,
        ops: {
          ...t.ops,
          openSync: open,
          fstatSync: fstat,
          renameSync: (() => {
            t.log.push('rename-failed');
            throw errno('EBUSY');
          }) as unknown as FsOps['renameSync'],
        },
      }),
    );
    expect(e.publication).toBe('NOT_PUBLISHED');
    expect(openDuringChecks).toBe(true);
    // close(writing) precedes publication; the unlink of the temp name happens strictly before the single close(identity)
    expect(t.log.filter((x) => x === 'unlink' || x === 'close')).toEqual(['close', 'unlink', 'close']);
    t.expectBalanced();
  });

  it('a name that matches the stale recorded dev/ino but disagrees with the live descriptor is NOT ours (UNKNOWN, nothing removed)', () => {
    const u = counted('unlinkSync', realFsOps.unlinkSync);
    let armed = false;
    let foreign = '';
    // After the failed rename the descriptor reports a different inode than the
    // one recorded at creation: the stale token must not be trusted by itself.
    const fstat = ((fd: number, o?: unknown) => {
      const st = realFsOps.fstatSync(fd, o as never) as unknown as { ino: bigint };
      return armed ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { ino: st.ino + 1n }) : st;
    }) as unknown as FsOps['fstatSync'];
    const e = caught(() =>
      replaceFile(parent(), 'state.json', 'NEW', {
        ...OPTS,
        ops: {
          unlinkSync: u.fn,
          fstatSync: fstat,
          renameSync: ((a: string) => {
            foreign = a;
            armed = true; // the temp name is still the file recorded by the token
            throw errno('EBUSY');
          }) as unknown as FsOps['renameSync'],
        },
      }),
    );
    expect(e.publication).toBe('UNKNOWN');
    expect(e.code).toBe('WRITE_PUBLICATION_UNKNOWN');
    expect(u.calls()).toBe(0);
    expect(readFileSync(foreign, 'utf8')).toBe('NEW');
  });

  it('real filesystem: a foreign file put under the temp name never inherits the held inode', () => {
    const u = counted('unlinkSync', realFsOps.unlinkSync);
    let heldIno = 0n;
    let reused = 0;
    let foreignPath = '';
    const e = caught(() =>
      replaceFile(parent(), 'state.json', 'NEW', {
        ...OPTS,
        ops: {
          unlinkSync: u.fn,
          renameSync: ((a: string) => {
            foreignPath = a;
            heldIno = lstatSync(a, { bigint: true }).ino;
            // churn: free the temp name and try to get the same inode number back
            for (let i = 0; i < 200; i++) {
              realFsOps.unlinkSync(a);
              writeFileSync(a, 'FOREIGN');
              if (lstatSync(a, { bigint: true }).ino === heldIno) reused++;
            }
            throw errno('EBUSY');
          }) as unknown as FsOps['renameSync'],
        },
      }),
    );
    expect(reused).toBe(0); // the open descriptor pins the inode
    expect(e.publication).toBe('UNKNOWN');
    expect(u.calls()).toBe(0); // the primitive never unlinks the foreign file (the churn uses the real fs)
    expect(readFileSync(foreignPath, 'utf8')).toBe('FOREIGN');
  });

  it('a symlink under the temp name is not ours and is left alone', () => {
    const target = join(base, 'target');
    writeFileSync(target, 'T');
    const u = counted('unlinkSync', realFsOps.unlinkSync);
    let at = '';
    const e = caught(() =>
      replaceFile(parent(), 'state.json', 'NEW', {
        ...OPTS,
        ops: {
          unlinkSync: u.fn,
          renameSync: ((a: string) => {
            at = a;
            realFsOps.unlinkSync(a);
            symlinkSync(target, a);
            throw errno('EBUSY');
          }) as unknown as FsOps['renameSync'],
        },
      }),
    );
    expect(e.publication).toBe('UNKNOWN');
    expect(u.calls()).toBe(0);
    expect(lstatSync(at).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('T');
  });

  it('fstat failing during cleanup: nothing is unlinked, the descriptor is still closed once', () => {
    const t = tracker();
    let broken = false;
    const fstat = ((fd: number, o?: unknown) => {
      if (broken) throw errno('EIO');
      return realFsOps.fstatSync(fd, o as never);
    }) as unknown as FsOps['fstatSync'];
    const e = caught(() =>
      replaceFile(parent(), 'state.json', 'NEW', {
        ...OPTS,
        ops: {
          ...t.ops,
          fstatSync: fstat,
          renameSync: (() => {
            broken = true;
            throw errno('EBUSY');
          }) as unknown as FsOps['renameSync'],
        },
      }),
    );
    expect(e.publication).toBe('UNKNOWN');
    expect(t.log).not.toContain('unlink');
    expect(tmpNames().length).toBe(1);
    t.expectBalanced();
  });

  it('unlink failing on our own temp file is reported (owned, not removed)', () => {
    const t = tracker();
    const e = caught(() =>
      replaceFile(parent(), 'state.json', 'NEW', {
        ...OPTS,
        ops: {
          ...t.ops,
          unlinkSync: (() => {
            throw errno('EACCES');
          }) as unknown as FsOps['unlinkSync'],
          renameSync: (() => {
            throw errno('EBUSY');
          }) as unknown as FsOps['renameSync'],
        },
      }),
    );
    expect(e.publication).toBe('NOT_PUBLISHED');
    expect(e.tmp).toMatchObject({ owned: true, removed: false });
    t.expectBalanced();
  });

  describe('descriptor lifecycle: every descriptor is closed exactly once', () => {
    it('replaceFile success', () => {
      const t = tracker();
      replaceFile(parent(), 'state.json', 'NEW', { ...OPTS, ops: t.ops });
      t.expectBalanced();
      expect(tmpNames()).toEqual([]);
    });

    it('createFile success keeps hardlink semantics: one name left, nlink 1, temp name removed', () => {
      const t = tracker();
      const out = createFile(parent(), 'n.txt', 'mine', { ...OPTS, ops: t.ops });
      expect(out.publication).toBe('PUBLISHED');
      expect(lstatSync(join(project, 'n.txt')).nlink).toBe(1);
      expect(readdirSync(project).sort()).toEqual(['n.txt', 'state.json']);
      t.expectBalanced();
    });

    it('createFile lost race (EEXIST, foreign destination): temp removed, descriptor closed once', () => {
      const t = tracker();
      const e = caught(() =>
        createFile(parent(), 'n.txt', 'mine', {
          ...OPTS,
          ops: {
            ...t.ops,
            linkSync: ((_a: string, b: string) => {
              writeFileSync(b, 'FOREIGN');
              throw errno('EEXIST');
            }) as FsOps['linkSync'],
          },
        }),
      );
      expect(e.code).toBe('WRITE_TARGET_EXISTS');
      expect(tmpNames()).toEqual([]);
      expect(readFileSync(join(project, 'n.txt'), 'utf8')).toBe('FOREIGN');
      t.expectBalanced();
    });

    it('rename failure (NOT_PUBLISHED) and publication UNKNOWN both release the descriptor', () => {
      const t1 = tracker();
      caught(() =>
        replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          ops: { ...t1.ops, renameSync: (() => { throw errno('EBUSY'); }) as unknown as FsOps['renameSync'] },
        }),
      );
      t1.expectBalanced();
      const t2 = tracker();
      caught(() =>
        replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          ops: {
            ...t2.ops,
            renameSync: ((a: string) => { realFsOps.unlinkSync(a); throw errno('ENOENT'); }) as FsOps['renameSync'],
          },
        }),
      );
      t2.expectBalanced();
    });

    it.each([
      ['write', 'writeSync'],
      ['fchmod', 'fchmodSync'],
      ['fsync', 'fsyncSync'],
    ] as const)('an early %s failure in stage removes the temp file and closes the descriptor once', (_label, op) => {
      const t = tracker();
      const e = caught(() =>
        replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          ops: { ...t.ops, [op]: (() => { throw errno('EIO'); }) as unknown as never },
        }),
      );
      expect(e.publication).toBe('NOT_PUBLISHED');
      expect(e.tmp).toMatchObject({ owned: true, removed: true });
      expect(tmpNames()).toEqual([]);
      // cleanup first (unlink), then both descriptors are released exactly once
      expect(t.log.filter((x) => x === 'unlink' || x === 'close')).toEqual(['unlink', 'close', 'close']);
      t.expectBalanced();
    });

    it('a failing ownership verification (fstat after write) removes the temp file and closes once', () => {
      const t = tracker();
      let n = 0;
      const e = caught(() =>
        replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          ops: {
            ...t.ops,
            fstatSync: ((fd: number, o?: unknown) => {
              const st = realFsOps.fstatSync(fd, o as never) as unknown as { nlink: bigint };
              // calls: 1 create, 2 mode inspection (owner-read elevation), 3-4 identity check (writing, identity), 5 verification after write
              return ++n === 5 ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { nlink: 5n }) : st;
            }) as unknown as FsOps['fstatSync'],
          },
        }),
      );
      expect(e.code).toBe('WRITE_VERIFY_FAILED');
      expect(tmpNames()).toEqual([]);
      t.expectBalanced();
    });

    it('a close error on the failure path does not mask the original error', () => {
      const e = caught(() =>
        replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          ops: {
            fsyncSync: (() => { throw errno('EIO'); }) as unknown as FsOps['fsyncSync'],
            closeSync: ((fd: number) => {
              realFsOps.closeSync(fd);
              throw errno('EBADF');
            }) as FsOps['closeSync'],
          },
        }),
      );
      expect(e.code).toBe('WRITE_FSYNC_FAILED');
      expect(e.publication).toBe('NOT_PUBLISHED');
      expect(e.message).toContain('failed to close');
      expect(tmpNames()).toEqual([]);
    });

    it('a repeated disposeOwned (token only) is harmless: removed, then absent; a symlink under the name is not-owned', () => {
      // NOTE: the token-only form (used by lock.ts, which closes its own descriptor)
      // cannot tell a foreign REGULAR file that recycled the inode from ours; that is
      // exactly why the writes in this module dispose against the live descriptor.
      const p = parent();
      const owned = createExclusive(p, 'x.tmp.1.a', 0o600);
      realFsOps.closeSync(owned.fd);
      expect(disposeOwned(p, owned.token)).toBe('removed');
      expect(disposeOwned(p, owned.token)).toBe('absent');
      symlinkSync(join(base, 'nowhere'), join(project, 'x.tmp.1.a'));
      expect(disposeOwned(p, owned.token)).toBe('not-owned');
      expect(lstatSync(join(project, 'x.tmp.1.a')).isSymbolicLink()).toBe(true);
    });
  });
});

// ALPHA4-SEC-SAFEWRITE-005: two independent descriptors. The WRITING fd is closed
// BEFORE publication (ADR-012: deferred write errors surface at close); a
// separate read-only IDENTITY fd pins the inode until publication and cleanup
// are done.
describe('Dual-FD: writing fd closed before publication, identity fd held until cleanup', () => {
  /** Opens/closes through the injected ops. Every close really closes (no real fd leaks from fault injection). */
  function spy(failCloseOfOpen?: number) {
    const opens: { fd: number; flags: number; path: string }[] = [];
    const closes = new Map<number, number>();
    const ops = {
      openSync: ((p: string, f: number, m?: number) => {
        const fd = realFsOps.openSync(p, f, m);
        opens.push({ fd, flags: f, path: p });
        return fd;
      }) as FsOps['openSync'],
      closeSync: ((fd: number) => {
        const n = (closes.get(fd) ?? 0) + 1;
        closes.set(fd, n);
        realFsOps.closeSync(fd);
        if (failCloseOfOpen !== undefined && opens[failCloseOfOpen]?.fd === fd && n === 1) throw errno('EIO');
      }) as FsOps['closeSync'],
    };
    const writingFd = (): number => opens[0].fd;
    const identityFd = (): number => opens[1].fd;
    /** Each open is matched by exactly one close of that descriptor number: no leak, no double close, no foreign fd. */
    const expectBalanced = (): void => {
      const o = new Map<number, number>();
      for (const x of opens) o.set(x.fd, (o.get(x.fd) ?? 0) + 1);
      for (const [fd, n] of o) expect(closes.get(fd)).toBe(n);
      expect([...closes.keys()].every((fd) => o.has(fd))).toBe(true);
    };
    return { opens, closes, ops, writingFd, identityFd, expectBalanced };
  }

  beforeEach(() => writeFileSync(join(project, 'state.json'), 'OLD'));

  /** Replace whatever the temp name is with `make(path)` right before the identity descriptor is opened. */
  function swapBeforeIdentityOpen(t: ReturnType<typeof spy>, make: (path: string) => void): FsOps['openSync'] {
    return ((p: string, f: number, m?: number) => {
      if (t.opens.length === 1) {
        realFsOps.unlinkSync(p);
        make(p);
      }
      return t.ops.openSync(p, f, m);
    }) as FsOps['openSync'];
  }

  describe('A. durability order', () => {
    it('replaceFile: close(writing fd) < rename, identity fd still open and usable at rename', () => {
      const t = spy();
      let writingClosed = false;
      let identityOpen = false;
      replaceFile(parent(), 'state.json', 'NEW', {
        ...OPTS,
        ops: {
          ...t.ops,
          renameSync: ((a: string, b: string) => {
            writingClosed = t.closes.get(t.writingFd()) === 1;
            identityOpen = !t.closes.has(t.identityFd()) && realFsOps.fstatSync(t.identityFd()).isFile();
            return realFsOps.renameSync(a, b);
          }) as FsOps['renameSync'],
        },
      });
      expect(writingClosed).toBe(true);
      expect(identityOpen).toBe(true);
      expect(t.identityFd()).not.toBe(t.writingFd());
      t.expectBalanced();
    });

    it('createFile: close(writing fd) < link, identity fd still open and usable at link', () => {
      const t = spy();
      let writingClosed = false;
      let identityOpen = false;
      createFile(parent(), 'n.txt', 'mine', {
        ...OPTS,
        ops: {
          ...t.ops,
          linkSync: ((a: string, b: string) => {
            writingClosed = t.closes.get(t.writingFd()) === 1;
            identityOpen = !t.closes.has(t.identityFd()) && realFsOps.fstatSync(t.identityFd()).isFile();
            return realFsOps.linkSync(a, b);
          }) as FsOps['linkSync'],
        },
      });
      expect(writingClosed).toBe(true);
      expect(identityOpen).toBe(true);
      t.expectBalanced();
    });

    it('the identity fd is a separate read-only open: O_RDONLY|O_NOFOLLOW|O_NONBLOCK, not a dup', () => {
      const t = spy();
      replaceFile(parent(), 'state.json', 'NEW', { ...OPTS, ops: t.ops });
      expect(t.opens[1].path).toBe(t.opens[0].path);
      expect(t.opens[1].flags).toBe(constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    });

    it('without O_NOFOLLOW: no O_NOFOLLOW but still O_NONBLOCK, PLATFORM_BEST_EFFORT stays', () => {
      const t = spy();
      const out = createFile(parent(), 'n.txt', 'mine', {
        ...OPTS,
        caps: { noFollow: false, dirFsync: false, posix: false },
        ops: t.ops,
      });
      expect(t.opens[1].flags).toBe(constants.O_RDONLY | constants.O_NONBLOCK);
      expect(out.warnings.map((w) => w.code)).toContain('PLATFORM_BEST_EFFORT');
      t.expectBalanced();
    });
  });

  describe('B/C. identity opening fails closed (no publication)', () => {
    it('open error: NOT_PUBLISHED, temp removed (writing fd proves ownership), nothing leaks', () => {
      const t = spy();
      const r = counted('renameSync', realFsOps.renameSync);
      const e = caught(() =>
        replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          ops: {
            ...t.ops,
            renameSync: r.fn,
            openSync: ((p: string, f: number, m?: number) => {
              if (t.opens.length === 1) throw errno('EACCES');
              return t.ops.openSync(p, f, m);
            }) as FsOps['openSync'],
          },
        }),
      );
      expect(e.publication).toBe('NOT_PUBLISHED');
      expect(e.code).toBe('WRITE_VERIFY_FAILED');
      expect(e.tmp).toMatchObject({ owned: true, removed: true });
      expect(r.calls()).toBe(0);
      expect(tmpNames()).toEqual([]);
      expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('OLD');
      t.expectBalanced();
    });

    it('fstat error on the identity descriptor: NOT_PUBLISHED, temp removed, nothing leaks', () => {
      const t = spy();
      let n = 0;
      const r = counted('renameSync', realFsOps.renameSync);
      const e = caught(() =>
        replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          ops: {
            ...t.ops,
            renameSync: r.fn,
            fstatSync: ((fd: number, o?: unknown) => {
              if (++n === 3) throw errno('EIO'); // 1 create, 2 writing, 3 identity
              return realFsOps.fstatSync(fd, o as never);
            }) as unknown as FsOps['fstatSync'],
          },
        }),
      );
      expect(e.publication).toBe('NOT_PUBLISHED');
      expect(e.code).toBe('WRITE_VERIFY_FAILED');
      expect(r.calls()).toBe(0);
      expect(tmpNames()).toEqual([]);
      t.expectBalanced();
    });

    it('identity mismatch (a foreign file took the temp name): not published, the foreign file is NOT removed', () => {
      const t = spy();
      const u = counted('unlinkSync', realFsOps.unlinkSync);
      const r = counted('renameSync', realFsOps.renameSync);
      let at = '';
      const e = caught(() =>
        replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          ops: {
            ...t.ops,
            unlinkSync: u.fn,
            renameSync: r.fn,
            openSync: swapBeforeIdentityOpen(t, (p) => {
              at = p;
              writeFileSync(p, 'FOREIGN');
            }),
          },
        }),
      );
      expect(e.publication).toBe('NOT_PUBLISHED');
      expect(e.code).toBe('WRITE_VERIFY_FAILED');
      expect(e.tmp).toMatchObject({ owned: false, removed: false });
      expect(u.calls()).toBe(0);
      expect(r.calls()).toBe(0);
      expect(readFileSync(at, 'utf8')).toBe('FOREIGN');
      expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('OLD');
      t.expectBalanced();
    });

    it('a symlink under the temp name is refused by O_NOFOLLOW and left alone', () => {
      const target = join(base, 'target');
      writeFileSync(target, 'T');
      const t = spy();
      const u = counted('unlinkSync', realFsOps.unlinkSync);
      let at = '';
      const e = caught(() =>
        replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          ops: { ...t.ops, unlinkSync: u.fn, openSync: swapBeforeIdentityOpen(t, (p) => { at = p; symlinkSync(target, p); }) },
        }),
      );
      expect(e.publication).toBe('NOT_PUBLISHED');
      expect(e.code).toBe('WRITE_VERIFY_FAILED');
      expect(u.calls()).toBe(0);
      expect(lstatSync(at).isSymbolicLink()).toBe(true);
      expect(readFileSync(target, 'utf8')).toBe('T');
      t.expectBalanced();
    });

    it('fallback without O_NOFOLLOW: a symlink to a foreign regular file is caught by the identity comparison, nothing removed', () => {
      const target = join(base, 'target');
      writeFileSync(target, 'T');
      const t = spy();
      const u = counted('unlinkSync', realFsOps.unlinkSync);
      let at = '';
      const e = caught(() =>
        replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          caps: { noFollow: false, dirFsync: false, posix: false },
          ops: { ...t.ops, unlinkSync: u.fn, openSync: swapBeforeIdentityOpen(t, (p) => { at = p; symlinkSync(target, p); }) },
        }),
      );
      expect(e.publication).toBe('NOT_PUBLISHED');
      expect(e.code).toBe('WRITE_VERIFY_FAILED');
      expect(u.calls()).toBe(0);
      expect(lstatSync(at).isSymbolicLink()).toBe(true);
      expect(readFileSync(target, 'utf8')).toBe('T');
      t.expectBalanced();
    });

    it('a FIFO under the temp name does not block the open and is refused', () => {
      const t = spy();
      const u = counted('unlinkSync', realFsOps.unlinkSync);
      let at = '';
      const e = caught(() =>
        replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          ops: { ...t.ops, unlinkSync: u.fn, openSync: swapBeforeIdentityOpen(t, (p) => { at = p; execFileSync('mkfifo', [p]); }) },
        }),
      );
      expect(e.publication).toBe('NOT_PUBLISHED');
      expect(u.calls()).toBe(0);
      expect(lstatSync(at).isFIFO()).toBe(true);
      t.expectBalanced();
    });

    it('a creation mode the owner cannot read (0o200, exactMode:false) is published at exactly that mode (F-01 regression closed)', () => {
      const t = spy();
      const out = createFile(parent(), 'n.txt', 'x', { mode: 0o200, exactMode: false, ops: t.ops });
      expect(out.publication).toBe('PUBLISHED');
      expect(lstatSync(join(project, 'n.txt')).mode & 0o777).toBe(0o200 & ~currentUmask());
      expect(tmpNames()).toEqual([]);
      t.expectBalanced();
    });
  });

  describe('D/E. descriptor lifecycle and publication semantics', () => {
    it('close(writing fd) fails: NOT_PUBLISHED, rename is never called, temp removed, each fd closed once', () => {
      const t = spy(0);
      const r = counted('renameSync', realFsOps.renameSync);
      const e = caught(() => replaceFile(parent(), 'state.json', 'NEW', { ...OPTS, ops: { ...t.ops, renameSync: r.fn } }));
      expect(e.publication).toBe('NOT_PUBLISHED');
      expect(e.code).toBe('WRITE_FAILED');
      expect(e.tmp).toMatchObject({ owned: true, removed: true });
      expect(r.calls()).toBe(0);
      expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('OLD');
      expect(tmpNames()).toEqual([]);
      expect(t.closes.get(t.writingFd())).toBe(1); // a failed close is never repeated
      t.expectBalanced();
    });

    it('close(writing fd) fails in createFile: link is never called, nothing is created', () => {
      const t = spy(0);
      const l = counted('linkSync', realFsOps.linkSync);
      const e = caught(() => createFile(parent(), 'n.txt', 'x', { ...OPTS, ops: { ...t.ops, linkSync: l.fn } }));
      expect(e.publication).toBe('NOT_PUBLISHED');
      expect(l.calls()).toBe(0);
      expect(existsSync(join(project, 'n.txt'))).toBe(false);
      expect(tmpNames()).toEqual([]);
      t.expectBalanced();
    });

    describe('STAGING_DESCRIPTOR_CLOSE_FAILED (ALPHA4-SEC-SAFEWRITE-005A)', () => {
      const codes = (o: { warnings: { code: string }[] }): string[] => o.warnings.map((w) => w.code);

      it('A. replaceFile: PUBLISHED + STAGING_DESCRIPTOR_CLOSE_FAILED, no STAGING_RESIDUE, one close', () => {
        const t = spy(1);
        const out = replaceFile(parent(), 'state.json', 'NEW', { ...OPTS, ops: t.ops });
        expect(out.publication).toBe('PUBLISHED');
        expect(codes(out)).toContain('STAGING_DESCRIPTOR_CLOSE_FAILED');
        expect(codes(out)).not.toContain('STAGING_RESIDUE');
        expect(out.warnings.find((w) => w.code === 'STAGING_DESCRIPTOR_CLOSE_FAILED')?.message).toContain('EIO');
        expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('NEW');
        expect(tmpNames()).toEqual([]);
        expect(t.closes.get(t.identityFd())).toBe(1);
        t.expectBalanced();
      });

      it('B. createFile: PUBLISHED + STAGING_DESCRIPTOR_CLOSE_FAILED, no STAGING_RESIDUE, one close', () => {
        const t = spy(1);
        const out = createFile(parent(), 'n.txt', 'mine', { ...OPTS, ops: t.ops });
        expect(out.publication).toBe('PUBLISHED');
        expect(codes(out)).toContain('STAGING_DESCRIPTOR_CLOSE_FAILED');
        expect(codes(out)).not.toContain('STAGING_RESIDUE');
        expect(lstatSync(join(project, 'n.txt')).nlink).toBe(1);
        expect(t.closes.get(t.identityFd())).toBe(1);
        t.expectBalanced();
      });

      it('C. cleanup failure and identity close failure: both warnings are kept', () => {
        const t = spy(1);
        const out = createFile(parent(), 'n.txt', 'mine', {
          ...OPTS,
          ops: { ...t.ops, unlinkSync: (() => { throw errno('EACCES'); }) as unknown as FsOps['unlinkSync'] },
        });
        expect(out.publication).toBe('PUBLISHED');
        expect(codes(out)).toEqual(expect.arrayContaining(['STAGING_RESIDUE', 'STAGING_DESCRIPTOR_CLOSE_FAILED']));
        t.expectBalanced();
      });

      it('D. publication verified after a rename error: the close warning is added, not substituted', () => {
        const t = spy(1);
        const out = replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          ops: {
            ...t.ops,
            renameSync: ((a: string, b: string) => { realFsOps.renameSync(a, b); throw errno('EIO'); }) as FsOps['renameSync'],
          },
        });
        expect(out.publication).toBe('PUBLISHED');
        expect(codes(out)).toEqual(expect.arrayContaining(['PUBLICATION_VERIFIED_AFTER_ERROR', 'STAGING_DESCRIPTOR_CLOSE_FAILED']));
        t.expectBalanced();
      });

      it('D2. publication verified after a link error (createFile): both warnings kept', () => {
        const t = spy(1);
        const out = createFile(parent(), 'n.txt', 'mine', {
          ...OPTS,
          ops: {
            ...t.ops,
            linkSync: ((a: string, b: string) => { realFsOps.linkSync(a, b); throw errno('EIO'); }) as FsOps['linkSync'],
          },
        });
        expect(out.publication).toBe('PUBLISHED');
        expect(codes(out)).toEqual(expect.arrayContaining(['PUBLICATION_VERIFIED_AFTER_ERROR', 'STAGING_DESCRIPTOR_CLOSE_FAILED']));
        t.expectBalanced();
      });

      it('E. a failed identity close is never retried (exactly one close per descriptor)', () => {
        const t = spy(1);
        replaceFile(parent(), 'state.json', 'NEW', { ...OPTS, ops: t.ops });
        // fd numbers are reused (directory fsync), so compare closes with opens per number.
        const opensOf = (fd: number): number => t.opens.filter((o) => o.fd === fd).length;
        expect(t.closes.get(t.identityFd())).toBe(opensOf(t.identityFd()));
        expect(t.closes.get(t.writingFd())).toBe(opensOf(t.writingFd()));
        t.expectBalanced();
      });

      it('no identity-close warning when the close succeeds', () => {
        const t = spy();
        const out = replaceFile(parent(), 'state.json', 'NEW', { ...OPTS, ops: t.ops });
        expect(codes(out)).not.toContain('STAGING_DESCRIPTOR_CLOSE_FAILED');
      });
    });

    it('close(identity fd) fails after publication: still PUBLISHED, no wrong warning, no repeated close', () => {
      const t = spy(1);
      const out = replaceFile(parent(), 'state.json', 'NEW', { ...OPTS, ops: t.ops });
      expect(out.publication).toBe('PUBLISHED');
      expect(readFileSync(join(project, 'state.json'), 'utf8')).toBe('NEW');
      expect(tmpNames()).toEqual([]);
      // STAGING_RESIDUE means "a temporary file is left behind": false here.
      expect(out.warnings.map((w) => w.code)).not.toContain('STAGING_RESIDUE');
      expect(out.warnings.map((w) => w.message).join('\n')).not.toContain('the published file is complete');
      expect(t.closes.get(t.identityFd())).toBe(1);
      t.expectBalanced();
    });

    it('close(identity fd) fails after link publication: PUBLISHED, one name left', () => {
      const t = spy(1);
      const out = createFile(parent(), 'n.txt', 'mine', { ...OPTS, ops: t.ops });
      expect(out.publication).toBe('PUBLISHED');
      expect(lstatSync(join(project, 'n.txt')).nlink).toBe(1);
      expect(tmpNames()).toEqual([]);
      expect(out.warnings.map((w) => w.code)).not.toContain('STAGING_RESIDUE');
      t.expectBalanced();
    });

    it('rename failure with a failing identity close keeps the original error and says the close failed', () => {
      const t = spy(1);
      const e = caught(() =>
        replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          ops: { ...t.ops, renameSync: (() => { throw errno('EBUSY'); }) as unknown as FsOps['renameSync'] },
        }),
      );
      expect(e.publication).toBe('NOT_PUBLISHED');
      expect(e.message).toContain('cannot publish');
      expect(e.message).toContain('identity descriptor also failed to close');
      expect(tmpNames()).toEqual([]);
      t.expectBalanced();
    });

    it('link failure (NOT_PUBLISHED) and an unprovable result (UNKNOWN) both release the identity fd once', () => {
      const t1 = spy();
      const e1 = caught(() =>
        createFile(parent(), 'n.txt', 'x', {
          ...OPTS,
          ops: { ...t1.ops, linkSync: (() => { throw errno('EIO'); }) as unknown as FsOps['linkSync'] },
        }),
      );
      expect(e1.publication).toBe('NOT_PUBLISHED');
      expect(tmpNames()).toEqual([]);
      t1.expectBalanced();
      const t2 = spy();
      const e2 = caught(() =>
        replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          ops: { ...t2.ops, renameSync: ((a: string) => { realFsOps.unlinkSync(a); throw errno('ENOENT'); }) as FsOps['renameSync'] },
        }),
      );
      expect(e2.publication).toBe('UNKNOWN');
      t2.expectBalanced();
    });

    it('cleanup failure (unlink) after a failed rename: owned residue is reported, descriptors released once', () => {
      const t = spy();
      const e = caught(() =>
        replaceFile(parent(), 'state.json', 'NEW', {
          ...OPTS,
          ops: {
            ...t.ops,
            unlinkSync: (() => { throw errno('EACCES'); }) as unknown as FsOps['unlinkSync'],
            renameSync: (() => { throw errno('EBUSY'); }) as unknown as FsOps['renameSync'],
          },
        }),
      );
      expect(e.tmp).toMatchObject({ owned: true, removed: false });
      t.expectBalanced();
    });

    it('a real unremovable second name in createFile is still STAGING_RESIDUE (its real meaning)', () => {
      const t = spy();
      const out = createFile(parent(), 'n.txt', 'mine', {
        ...OPTS,
        ops: { ...t.ops, unlinkSync: (() => { throw errno('EACCES'); }) as unknown as FsOps['unlinkSync'] },
      });
      expect(out.publication).toBe('PUBLISHED');
      expect(out.warnings.map((w) => w.code)).toContain('STAGING_RESIDUE');
      t.expectBalanced();
    });

    it('no real descriptor leaks across success and failure paths (/proc/self/fd)', () => {
      if (!existsSync('/proc/self/fd')) return;
      const count = (): number => readdirSync('/proc/self/fd').length;
      const run = (fn: () => unknown): void => {
        try { fn(); } catch { /* expected */ }
      };
      const before = count();
      for (let i = 0; i < 10; i++) {
        replaceFile(parent(), 'state.json', 'NEW', OPTS);
        createFile(parent(), `n${i}.txt`, 'x', OPTS);
        const a = spy(0); run(() => replaceFile(parent(), 'state.json', 'X', { ...OPTS, ops: a.ops }));
        const b = spy(1); run(() => replaceFile(parent(), 'state.json', 'Y', { ...OPTS, ops: b.ops }));
        run(() => replaceFile(parent(), 'state.json', 'Z', { ...OPTS, ops: { renameSync: (() => { throw errno('EBUSY'); }) as unknown as FsOps['renameSync'] } }));
        run(() => replaceFile(parent(), 'state.json', 'W', { ...OPTS, ops: { writeSync: (() => { throw errno('EIO'); }) as unknown as FsOps['writeSync'] } }));
      }
      expect(count()).toBe(before);
    });
  });
});

// ALPHA4-SEC-SAFEWRITE-008: Owner-Read Elevation. A staging file created without
// owner-read gets 0o400 only for the open of the identity descriptor; the original
// mode is restored at the existing fchmod step (before fsync and close).
function currentUmask(): number {
  return Number(execFileSync('sh', ['-c', 'umask'], { encoding: 'utf8' }).trim().replace(/^/, '0o').replace('0o0o', '0o'));
}

describe('Owner-Read Elevation (SAFEWRITE-008)', () => {
  const asRoot = process.getuid?.() === 0;

  function spy() {
    const opens: { fd: number; flags: number }[] = [];
    const closes = new Map<number, number>();
    const fchmods: { fd: number; mode: number }[] = [];
    const seq: string[] = [];
    const ops = {
      openSync: ((p: string, f: number, m?: number) => {
        const fd = realFsOps.openSync(p, f, m);
        opens.push({ fd, flags: f });
        seq.push(`open${opens.length}`);
        return fd;
      }) as FsOps['openSync'],
      closeSync: ((fd: number) => {
        closes.set(fd, (closes.get(fd) ?? 0) + 1);
        seq.push(fd === opens[0]?.fd ? 'close-writing' : 'close-other');
        realFsOps.closeSync(fd);
      }) as FsOps['closeSync'],
      fchmodSync: ((fd: number, m: number) => {
        fchmods.push({ fd, mode: m });
        seq.push(`fchmod:${m.toString(8)}`);
        return realFsOps.fchmodSync(fd, m);
      }) as FsOps['fchmodSync'],
      fsyncSync: ((fd: number) => {
        seq.push('fsync');
        return realFsOps.fsyncSync(fd);
      }) as FsOps['fsyncSync'],
      renameSync: ((a: string, b: string) => {
        seq.push('publish');
        return realFsOps.renameSync(a, b);
      }) as FsOps['renameSync'],
      linkSync: ((a: string, b: string) => {
        seq.push('publish');
        return realFsOps.linkSync(a, b);
      }) as FsOps['linkSync'],
    };
    const balanced = (): void => {
      for (const o of opens) expect(closes.get(o.fd)).toBe(opens.filter((x) => x.fd === o.fd).length);
    };
    return { opens, closes, fchmods, seq, ops, balanced };
  }

  const modeOf = (n: string): number => lstatSync(join(project, n)).mode & 0o777;

  describe.each([0o200, 0o000])('A. createFile, exactMode:false, creation mode %s', (mode) => {
    it('is PUBLISHED at exactly the mode the umask leaves, no staging residue', () => {
      const t = spy();
      const out = createFile(parent(), 'n.txt', 'data', { mode, exactMode: false, ops: t.ops });
      expect(out.publication).toBe('PUBLISHED');
      expect(modeOf('n.txt')).toBe(mode & ~currentUmask());
      expect(tmpNames()).toEqual([]);
      expect(out.warnings.map((w) => w.code)).not.toContain('STAGING_RESIDUE');
      t.balanced();
    });
  });

  describe.each([0o200, 0o000])('B. replaceFile (new destination), exactMode:false, creation mode %s', (mode) => {
    it('is PUBLISHED at exactly the mode the umask leaves, no staging residue', () => {
      const t = spy();
      const out = replaceFile(parent(), 'n.txt', 'data', { mode, exactMode: false, ops: t.ops });
      expect(out.publication).toBe('PUBLISHED');
      expect(modeOf('n.txt')).toBe(mode & ~currentUmask());
      expect(tmpNames()).toEqual([]);
      t.balanced();
    });
  });

  describe.each([0o600, 0o666])('C. normal creation mode %s', (mode) => {
    it('no elevation and no fchmod at all with exactMode:false', () => {
      const t = spy();
      createFile(parent(), 'n.txt', 'data', { mode, exactMode: false, ops: t.ops });
      expect(t.fchmods).toEqual([]);
      t.balanced();
    });
    it('exactMode:true: exactly one fchmod, to the final mode', () => {
      const t = spy();
      createFile(parent(), 'n.txt', 'data', { mode, ops: t.ops });
      expect(t.fchmods.map((f) => f.mode)).toEqual([mode]);
      t.balanced();
    });
  });

  it('D. umask semantics are unchanged for several umask values (separate child process)', () => {
    // The child gets its own umask; the umask of this test process is never touched.
    const out = join(base, 'compiled');
    mkdirSync(out);
    writeFileSync(join(out, 'package.json'), '{"type":"module"}');
    for (const f of readdirSync(__dirname).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const js = ts.transpileModule(readFileSync(join(__dirname, f), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
      writeFileSync(join(out, f.replace(/\.ts$/, '.js')), js.outputText);
    }
    const bundle = join(out, 'index.js');
    const script = `
      import { mkdtempSync, mkdirSync, lstatSync, rmSync } from 'fs';
      import { join } from 'path';
      import { tmpdir } from 'os';
      import { createFile, openParent, projectBoundary } from ${JSON.stringify(bundle)};
      const out = {};
      for (const u of [0o000, 0o022, 0o077, 0o277]) {
        const base = mkdtempSync(join(tmpdir(), 'monolith-umask-'));
        const proj = join(base, 'p'); mkdirSync(proj);
        process.umask(u);
        for (const m of [0o200, 0o000, 0o600, 0o666]) {
          createFile(openParent(projectBoundary(proj), proj), 'f' + m.toString(8), 'x', { mode: m, exactMode: false });
          out[u.toString(8) + ':' + m.toString(8)] = lstatSync(join(proj, 'f' + m.toString(8))).mode & 0o777;
        }
        rmSync(base, { recursive: true, force: true });
      }
      console.log(JSON.stringify(out));
    `;
    const res = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    const got = JSON.parse(res.trim().split('\n').pop()!) as Record<string, number>;
    for (const u of [0o000, 0o022, 0o077, 0o277]) {
      for (const m of [0o200, 0o000, 0o600, 0o666]) {
        expect(got[`${u.toString(8)}:${m.toString(8)}`]).toBe(m & ~u);
      }
    }
  });

  it('elevates exactly once, to (original | 0o400), restores the original, in that order', () => {
    const t = spy();
    createFile(parent(), 'n.txt', 'data', { mode: 0o200, exactMode: false, ops: t.ops });
    const created = 0o200 & ~currentUmask();
    expect(t.fchmods.map((f) => f.mode)).toEqual([created | 0o400, created]);
    // elevation precedes the identity open (second open)
    expect(t.seq.indexOf(`fchmod:${(created | 0o400).toString(8)}`)).toBeLessThan(t.seq.indexOf('open2'));
  });

  it('E. elevation failure: NOT_PUBLISHED, temp removed, identity never opened, no publication', () => {
    const t = spy();
    const e = caught(() =>
      createFile(parent(), 'n.txt', 'x', {
        mode: 0o200,
        exactMode: false,
        ops: { ...t.ops, fchmodSync: (() => { throw errno('EPERM'); }) as FsOps['fchmodSync'] },
      }),
    );
    expect(e.publication).toBe('NOT_PUBLISHED');
    expect(e.tmp).toMatchObject({ owned: true, removed: true });
    expect(t.opens).toHaveLength(1);
    expect(t.seq).not.toContain('publish');
    expect(existsSync(join(project, 'n.txt'))).toBe(false);
    expect(tmpNames()).toEqual([]);
    t.balanced();
  });

  it('F. identity open fails after elevation: restore attempted, temp removed, original error kept', () => {
    const t = spy();
    const e = caught(() =>
      createFile(parent(), 'n.txt', 'x', {
        mode: 0o200,
        exactMode: false,
        ops: {
          ...t.ops,
          openSync: ((p: string, f: number, m?: number) => {
            if (t.opens.length === 1) throw errno('EMFILE');
            return t.ops.openSync(p, f, m);
          }) as FsOps['openSync'],
        },
      }),
    );
    const created = 0o200 & ~currentUmask();
    expect(e.publication).toBe('NOT_PUBLISHED');
    expect(e.code).toBe('WRITE_VERIFY_FAILED');
    expect(e.message).toContain('EMFILE');
    expect(e.message).not.toContain('could not be restored');
    expect(t.fchmods.map((f) => f.mode)).toEqual([created | 0o400, created]);
    expect(e.tmp).toMatchObject({ owned: true, removed: true });
    expect(tmpNames()).toEqual([]);
    t.balanced();
  });

  it('G. restore fchmod fails: not published, restore retried in abort, diagnostics name it', () => {
    const t = spy();
    let n = 0;
    const r = counted('renameSync', realFsOps.renameSync);
    const e = caught(() =>
      replaceFile(parent(), 'n.txt', 'x', {
        mode: 0o200,
        exactMode: false,
        ops: {
          ...t.ops,
          renameSync: r.fn,
          fchmodSync: ((fd: number, m: number) => {
            n++;
            if (n === 2) throw errno('EIO'); // the restore at the normal fchmod step
            return t.ops.fchmodSync(fd, m);
          }) as FsOps['fchmodSync'],
        },
      }),
    );
    const created = 0o200 & ~currentUmask();
    expect(e.publication).toBe('NOT_PUBLISHED');
    expect(r.calls()).toBe(0);
    expect(n).toBe(3); // elevation, failed restore, retry in abort
    expect(t.fchmods.at(-1)?.mode).toBe(created);
    expect(e.tmp).toMatchObject({ owned: true, removed: true });
    expect(tmpNames()).toEqual([]);
    expect(existsSync(join(project, 'n.txt'))).toBe(false);
    t.balanced();
  });

  it('H. restore and cleanup both fail: no false claim of cleanup, no double close, not published', () => {
    const t = spy();
    const l = counted('linkSync', realFsOps.linkSync);
    const e = caught(() =>
      createFile(parent(), 'n.txt', 'x', {
        mode: 0o200,
        exactMode: false,
        ops: {
          ...t.ops,
          linkSync: l.fn,
          fchmodSync: ((fd: number, m: number) => {
            if (t.fchmods.length >= 1) throw errno('EIO'); // every restore attempt fails
            return t.ops.fchmodSync(fd, m);
          }) as FsOps['fchmodSync'],
          unlinkSync: (() => { throw errno('EBUSY'); }) as FsOps['unlinkSync'],
        },
      }),
    );
    expect(e.publication).toBe('NOT_PUBLISHED');
    expect(l.calls()).toBe(0);
    expect(e.tmp).toMatchObject({ owned: true, removed: false });
    expect(e.message).toContain('could not be restored');
    expect(e.message).toContain('could not be removed');
    expect(e.message).toContain('owner-read permission added');
    expect(existsSync(join(project, 'n.txt'))).toBe(false);
    for (const [, n] of t.closes) expect(n).toBe(1);
    t.balanced();
    for (const f of tmpNames()) { chmodSync(join(project, f), 0o600); rmSync(join(project, f), { force: true }); }
  });

  it('H2. restore fails and the staging name now holds a foreign file: no claim about it, nothing deleted or chmod-ed', () => {
    const t = spy();
    let swapped = false;
    const e = caught(() =>
      createFile(parent(), 'n.txt', 'x', {
        mode: 0o200,
        exactMode: false,
        ops: {
          ...t.ops,
          fchmodSync: ((fd: number, m: number) => {
            if (t.fchmods.length >= 1) {
              if (!swapped) {
                swapped = true;
                const tmp = tmpNames()[0];
                unlinkSync(join(project, tmp));
                writeFileSync(join(project, tmp), 'FOREIGN', { mode: 0o640 });
              }
              throw errno('EIO'); // every restore attempt fails
            }
            return t.ops.fchmodSync(fd, m);
          }) as FsOps['fchmodSync'],
        },
      }),
    );
    expect(e.publication).toBe('NOT_PUBLISHED');
    expect(e.tmp).toMatchObject({ owned: false, removed: false });
    expect(e.message).toContain('could not be restored');
    expect(e.message).toContain('NOT removed');
    expect(e.message).not.toContain('owner-read permission added');
    const [foreign] = tmpNames();
    expect(readFileSync(join(project, foreign), 'utf8')).toBe('FOREIGN');
    expect(lstatSync(join(project, foreign)).mode & 0o777).toBe(0o640 & ~currentUmask());
    expect(existsSync(join(project, 'n.txt'))).toBe(false);
    for (const [, n] of t.closes) expect(n).toBe(1);
    t.balanced();
    for (const f of tmpNames()) rmSync(join(project, f), { force: true });
  });

  it('I. durability order: restore fchmod < fsync < close(writing) < publish', () => {
    for (const kind of ['createFile', 'replaceFile'] as const) {
      const t = spy();
      const fn = kind === 'createFile' ? createFile : replaceFile;
      fn(parent(), `${kind}.txt`, 'x', { mode: 0o200, exactMode: false, ops: t.ops });
      const created = 0o200 & ~currentUmask();
      const iRestore = t.seq.lastIndexOf(`fchmod:${created.toString(8)}`);
      const iFsync = t.seq.indexOf('fsync');
      const iClose = t.seq.indexOf('close-writing');
      const iPub = t.seq.indexOf('publish');
      expect(iRestore).toBeGreaterThan(-1);
      expect(iRestore).toBeLessThan(iFsync);
      expect(iFsync).toBeLessThan(iClose);
      expect(iClose).toBeLessThan(iPub);
    }
  });

  it('J. ABA: a staging name swapped after elevation is not removed and nothing is published', () => {
    const t = spy();
    const u = counted('unlinkSync', realFsOps.unlinkSync);
    const r = counted('linkSync', realFsOps.linkSync);
    let swapped = '';
    const e = caught(() =>
      createFile(parent(), 'n.txt', 'x', {
        mode: 0o200,
        exactMode: false,
        ops: {
          ...t.ops,
          unlinkSync: u.fn,
          linkSync: r.fn,
          openSync: ((p: string, f: number, m?: number) => {
            if (t.opens.length === 1) {
              realFsOps.unlinkSync(p);
              writeFileSync(p, 'foreign');
              swapped = p;
            }
            return t.ops.openSync(p, f, m);
          }) as FsOps['openSync'],
        },
      }),
    );
    expect(e.publication).toBe('NOT_PUBLISHED');
    expect(r.calls()).toBe(0);
    expect(u.calls()).toBe(0);
    expect(readFileSync(swapped, 'utf8')).toBe('foreign');
    t.balanced();
  });

  it('K. FD lifecycle: each descriptor opened is closed exactly once on success paths', () => {
    for (const mode of [0o200, 0o000, 0o600]) {
      for (const fn of [createFile, replaceFile]) {
        const t = spy();
        fn(parent(), `f${fn.name}${mode}.txt`, 'x', { mode, exactMode: false, ops: t.ops });
        expect(t.opens).toHaveLength(3); // writing + identity + directory (fsync)
        // fd numbers are reused, so compare totals: one close per open, never more
        expect([...t.closes.values()].reduce((a, b) => a + b, 0)).toBe(t.opens.length);
        t.balanced();
      }
    }
  });

  it.skipIf(asRoot)('existing target is never elevated: preserveMode keeps an unreadable destination mode and the target is not chmodded', () => {
    const dest = join(project, 'state.json');
    writeFileSync(dest, 'OLD');
    chmodSync(dest, 0o200);
    const t = spy();
    replaceFile(parent(), 'state.json', 'NEW', { mode: 0o600, ops: t.ops });
    expect(t.fchmods.every((f) => f.mode !== (0o200 | 0o400))).toBe(true);
  });
});
