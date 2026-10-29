---
type: adr
id: ADR-012
title: Safe Writes and Explicit Write Scope (SEC-001B.2)
status: accepted
date: 2026-10-23
related_adrs:
  - ADR-008
  - ADR-009
  - ADR-011
  - ADR-013
  - ADR-014
---

# ADR-012 — Safe Writes and Explicit Write Scope (SEC-001B.2)

## Context

SEC-001A contained `monolithRoot`, SEC-002 made `validate` static and
SEC-001B.1 bounded every read. Writes were still unguarded. The SEC-001B.2
preflight (2026-10-23) inventoried every write in `src/` and verified, in a
temporary directory, that:

- `monolith init` follows a pre-existing symlink at a template target, including
  a **dangling** one: `existsSync()` is `false` for a dangling link, so the
  conflict preflight passes and `writeFileSync()` creates the link's target
  outside the project. Parent components were never inspected either.
- `state.json.tmp.*` was created with flag `'w'` (no `O_EXCL`, follows symlinks).
- Replacing `state.json` via temp + `rename` silently changed its mode
  (`0600` became `0664`), replaced a FIFO or symlink at the destination and
  silently detached a hardlink.
- Neither the file nor its directory was fsynced.
- Nothing distinguished "the rename failed" from "the rename may have happened".

## Decision

### Write scope is explicit (no default)

Every write is performed against a **write boundary** created by one of two
constructors; there is no boundary-less write.

| | `project` | `trusted-directory` |
|---|---|---|
| Declared by | the caller passes the project root | the caller passes the directory itself |
| Boundary | `realpath(projectRoot)` | `realpath(dir)` |
| Target directory | must lie inside the root, else `WRITE_OUTSIDE_BOUNDARY` | the directory or below |
| Ancestors of the boundary | trusted (the root the user pointed at) | trusted **because the caller asserts it**; nothing about them is checked |
| Below the boundary | every component is `lstat`-checked: not a symlink, a directory | same |

In `trusted-directory` mode a symlinked `.monolith` is invisible: it is the
directory itself or one of its ancestors. The CLI therefore always uses
`project` scope.

**Public API migration.** `mutateState`, `startMission`, `finishMission` (and the
internal `createCheckpoint`) take a `StateWriteTarget`
(`{ scope: 'project', projectRoot, stateDir }` or
`{ scope: 'trusted-directory', stateDir }`, optional `onWarning`). The former
`string` first argument is **removed**: a string overload would silently pick a
trust model. Calling without a scope throws `WRITE_SCOPE_REQUIRED`. Read
functions (`readState`, `listMissions`, `getMission`, `listCheckpoints`,
`getCheckpoint`) keep a plain `stateDir`; they do not write.
`mutateState` additionally returns `warnings`; `onWarning` is called once per warning **after** the state lock is released, and an exception it throws is ignored. The package is `0.1.0-alpha`, so
no deprecation period is provided. `scaffoldInstance` is project-scoped by
construction (`targetDir` is the project root) and is not exported from the
package entrypoint.

### W-SYM — symlinks are refused for writes

Any symlink below the boundary, **including one that stays inside the project**,
is refused for writes (`WRITE_PARENT_SYMLINK`, `WRITE_TARGET_SYMLINK`). Reads of
managed files followed the ADR-009 policy (in-project symlinks allowed) when this ADR
was written; since SEC-001B.1-R (ADR-014, merged) they are refused as well, so reads
and writes now share one symlink policy. A project that symlinks
`monolithRoot` must replace the link with a real directory before `mission
start|finish|checkpoint` or `init` will write.

### Single primitive

`src/root/safe-write.ts` is the one code path that **publishes** project files —
creates a new file or replaces an existing one:

- `createFile` — temp file, then `link()` to the final name; refuses to
  overwrite anything (a symlink, FIFO or file at the name yields `EEXIST`).
- `replaceFile` — temp file, then `rename()` over a regular, single-link file.
- `createExclusive` / `publishLink` / `disposeOwned` — used by lock staging.

This is a statement about *publication*, not about every filesystem mutation in
the repository. Mutations that do **not** go through the primitive:

| Mutation | Where | Notes |
|---|---|---|
| Lock release | `lock.ts` `releaseIfOwned` | `unlinkSync` of the lock path, only if the record read back is this process's own `pid:nonce`; path-based, so a name swapped between the read and the `unlink` is a residual race (SEC-001B.3) |
| Stale-lock recovery | `lock.ts` `recoverDeadOwner` | `unlinkSync` of the lock path of a confirmed-dead owner, under the recovery mutex (ADR-008); same residual race |
| Recovery mutex release | `lock.ts` `releaseIfOwned` | as lock release |
| `trusted-directory` directory creation | `state-keeper.ts` | `mkdirSync(stateDir, { recursive: true })`: the caller asserts the directory and its ancestors are trusted, so nothing about them is checked |
| Developer scripts | `src/scripts/dogfood-*.ts` | *(written 2026-10-23; since ERG-001A the only such script, `dogfood-graph.ts`, is read-only and prints to stdout — nothing is written)* write reports under `docs/`; not part of the CLI or the package API, not covered |

The temp file is always opened `O_CREAT|O_EXCL|O_NOFOLLOW` (where the platform
has `O_NOFOLLOW`; the constant is checked with `typeof`, because on Windows it
is `undefined` and `flag | undefined` silently drops it).

### DEC-B2-01 — permissions

New `state.json`, lock staging and lock: `0600` (set with `fchmod`, independent
of umask). Replacing an existing `state.json` keeps its mode (`& 0o777`;
setuid/setgid/sticky are not carried over). Existing files' modes are never
changed otherwise. Scaffold documents keep `0666 & ~umask` (templates contain no
executables); a scaffolded `state.json` is `0600`.

Consequences for existing users: an existing `state.json` no longer loses its
mode on rewrite; new projects get `0600`; **a directory shared between users or
containers with different uids** can no longer read a new `state.json` or
inspect a lock (the second user gets `FILE_UNREADABLE` / `LockUnsafeError`) —
use one uid or an explicit `chmod`. Owner, ACLs and extended attributes are not
preserved across `rename`.

### DEC-B2-02 — orphan files

No file is removed *as an orphan*. The only deletions are: (a) the temp file
created by the **current call**, and only when ownership is verified (below);
(b) a lock a process releases, only if it still holds that process's own
`pid:nonce`; (c) a dead owner's lock during stale-lock recovery under the
recovery mutex (ADR-008, unchanged). (b) and (c) are lock-protocol operations,
not safe-write publication, and are path-based (see "Single primitive"). No
cleanup by age, PID or file-name pattern. A crash leaves unowned residue
(`*.tmp.*`, `*.creating.*`, `*.recovery`) which is surfaced by read-only
diagnostics only. Safe cleanup is registered as FS-CLEAN-001 (backlog, not
decided).

### DEC-B2-03 — scaffold

`init` refuses a symlink (including dangling) at a target, a symlink or
non-directory in any parent component, a FIFO or other special file, a target
that appears concurrently, and any path outside the project boundary. Files are
created without overwriting, and each file becomes visible only once completely
written. **Not provided:** atomicity or rollback of the whole `init`, and
coordination of two concurrent `init` runs (SEC-001B.3). If `init` fails midway,
files already published stay and the error states how many were created.

### DEC-B2-04 — hardlinks

Replacing an existing file whose link count is greater than one is refused
(`WRITE_TARGET_HARDLINKED`); the hardlink is never silently detached. A lock
being published legitimately has two names for a moment and is not subject to
this check.

### DEC-B2-05 — platform

Security guarantees are stated for **POSIX** (verified on Linux; macOS/BSD
behaviour is expected but not verified here). Windows is best-effort and
**unverified**: no `O_NOFOLLOW`, no directory fsync, `rename` semantics differ.
Dangerous objects found by `lstat`/`fstat` (symlinks, non-regular files,
`nlink > 1`) are still refused there. A `PLATFORM_BEST_EFFORT` warning is
returned with every write; the CLI prints it once per process.

### Publication states

Every failed write reports `publication: 'NOT_PUBLISHED' | 'UNKNOWN'`; a write
that reached the final name is `PUBLISHED` and never throws.

**No errno is evidence about the destination.** An error can be reported for an
operation that took effect (a reply lost on the way back), and which errors can
follow success depends on the filesystem. After `rename`/`link` fails — with any
error code, including `ENOENT`, `EBUSY`, `EXDEV`, `EPERM` or `EEXIST` — the
outcome is decided by one read-only inspection of identity (`dev/ino` recorded
from the descriptor of the temp file), never by the code:

| Destination | Temp name | Result |
|---|---|---|
| is our file | — | `PUBLISHED`, with a `PUBLICATION_VERIFIED_AFTER_ERROR` warning |
| is not our file (or absent) | still our file | `rename`, or `link` with any other error: `NOT_PUBLISHED` (temp file removed, as ownership is verified). `link`+`EEXIST`: see the special cases below |
| anything else, or an inspection fails | gone / not ours / undecidable | `UNKNOWN` |

`link`+`EEXIST` has its own classification, because `EEXIST` is also the normal
answer of a lost race. After the identity of the destination is checked (ours →
`PUBLISHED`, always):

| Destination | Temp name | Result |
|---|---|---|
| present, not our file (including a symlink or special file) | still our file | lost race: `NOT_PUBLISHED`; the name belongs to someone else |
| absent | still our file, link count 1 | lost race (the name vanished again; nothing of ours was linked): `NOT_PUBLISHED` |
| absent | still our file, link count > 1 | `UNKNOWN` |
| anything else, or an inspection fails | gone / not ours | `UNKNOWN` |

The **link count of the temp file is not evidence of publication**: a second hard
link to the temp name (a backup tool, another local actor) would make a foreign
destination look like ours. Only the identity of the destination proves
`PUBLISHED`; the link count is used solely to tell "vanished again" from
"cannot tell" when the destination is absent.

`UNKNOWN` is **never** converted to `NOT_PUBLISHED` automatically, the publish
step is **never** retried, and nothing is deleted — in particular a temp name
that no longer shows our identity is left alone. After a successful publish, a
failing staging unlink or directory fsync is a **warning**, not an error:
throwing would invite a retry of a non-idempotent command (a second mission).

This classification is made from what one inspection shows, and one inspection
cannot separate every case. On a local POSIX filesystem a `link()` that took
effect does not report an error. On NFS/SMB it can (the reply is lost and the
retried call answers `EEXIST`). If the name we published is then replaced or
removed by someone else before the inspection, the destination no longer shows
our identity and our temp name is back to a single link, which is exactly what a
genuine lost race looks like: the call is classified `lost-race` / `NOT_PUBLISHED`
although the name was briefly ours. Telling the two apart would turn every
ordinary lost race into `UNKNOWN`, so this is accepted. Network filesystems are
outside the guaranteed contract; nothing here claims that undecidable situations
there always end in `UNKNOWN`.

The CLI words `UNKNOWN` differently for the two things that can be unknown:
for `state.json` it asks the user to check the missions; for the lock it states
that no state was written and points at the lock and its staging files
(read-only inspection, nothing removed automatically). The machine-readable
`code`, `publication`, `phase`, `path` and the original error (`cause`) are kept.

### Ownership and cleanup

A file may be removed only if (a) this call created it through a successful
`O_EXCL` open and (b) at removal time `lstat` of the same name shows a regular
file with the `dev/ino` recorded from `fstat(fd)` right after creation
(compared as `bigint`). The unlink itself cannot be made conditional without
`unlinkat`/dirfd, so a name swapped between the `lstat` and the `unlink` is a
residual race that this ADR does not claim to close.

### Durability order

create (`0600`, `O_EXCL`) → write → `fchmod` → `fstat` verification (regular,
`nlink == 1`, expected size/mode, recorded `dev/ino`, own uid) → `fsync(file)` →
`close` → publish → `unlink` staging (link variant) → `fsync(directory)`.
`fchmod` precedes `fsync` so the mode change is flushed with the data; `close`
precedes publish because network filesystems surface deferred write errors at
`close`. A failure at or before `close`/publish is `NOT_PUBLISHED`; `fsync` is
never retried after an error. A failure after publish yields a warning and a
lower reported `durability`. State uses full durability, scaffold fsyncs files
only, lock staging fsync stays opt-in (`fsyncMetadata`). macOS `fsync` does not
flush the drive cache; tmpfs has no durability to speak of.

### Lock

Ownership (`pid:nonce`), backoff, liveness, stale recovery, the recovery mutex
and the record format are unchanged. Only staging creation moves onto the shared
primitive. An `UNKNOWN` lock publication is confirmed by comparing the record at
the lock path with the one written; if that does not decide, the acquisition
fails without retry and without removing the staging file.

## SEC-001B.2 / SEC-001B.3 boundary

B.2 checks types, symlinks, hardlinks and boundaries **at the moment of each
operation**, and makes publication exclusive, atomic per file and durable. It
does **not** defend against a local actor who changes directories or symlinks
concurrently with MONOLITH. `ParentRef` (path + `dev/ino` snapshot) is
re-validated before operations, but that is a diagnostic tripwire only: the
operation afterwards resolves the path again. Replacing its internals with a
directory-descriptor design, scaffold transactionality, `init` coordination and
instance-tree hardening are SEC-001B.3.

The threat models (TM-A/B/C), the statement that TM-C is not supported, and the
deferral of a native descriptor-relative layer are recorded in ADR-013.

## Alternatives considered

- *String overload defaulting to `trusted-directory`.* Rejected: a hidden choice
  of trust model.
- *Automatic orphan cleanup by age/pattern.* Rejected: live writers use the same
  names; deletion on a heuristic is destructive.
- *In-place write with truncate.* Rejected: not atomic, follows hardlinks.
- *Refusing writes on Windows.* Rejected as a regression for current users;
  best-effort with a warning and still-active object checks chosen.

## Consequences

Safer scaffold, state and lock writes on POSIX; explicit trust model in the API;
more caller-visible refusals (symlinked parents, hardlinked `state.json`, shared
directories with several uids). Residual risks are tracked in
`.monolith/memory/long-term/tech-debt.md` (SEC-001B.3, FS-CLEAN-001).
