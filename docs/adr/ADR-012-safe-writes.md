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
`mutateState` additionally returns `warnings`. The package is `0.1.0-alpha`, so
no deprecation period is provided. `scaffoldInstance` is project-scoped by
construction (`targetDir` is the project root) and is not exported from the
package entrypoint.

### W-SYM — symlinks are refused for writes

Any symlink below the boundary, **including one that stays inside the project**,
is refused for writes (`WRITE_PARENT_SYMLINK`, `WRITE_TARGET_SYMLINK`). Reads keep
the ADR-009 policy (in-project symlinks allowed). A project that symlinks
`monolithRoot` must replace the link with a real directory before `mission
start|finish|checkpoint` or `init` will write.

### Single primitive

`src/root/safe-write.ts` is the only code path that creates, replaces or removes
project files:

- `createFile` — temp file, then `link()` to the final name; refuses to
  overwrite anything (a symlink, FIFO or file at the name yields `EEXIST`).
- `replaceFile` — temp file, then `rename()` over a regular, single-link file.
- `createExclusive` / `disposeOwned` — used by lock staging.

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

Nothing is deleted automatically except the temp file created by the **current
call**, and only when ownership is verified (below). No cleanup by age, PID or
file-name pattern. A crash leaves unowned residue (`*.tmp.*`, `*.creating.*`,
`*.recovery`) which is surfaced by read-only diagnostics only. Safe cleanup is
registered as FS-CLEAN-001 (backlog, not decided).

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

- `rename`/`link` errors in a fixed allowlist (`EACCES`, `EPERM`, `EROFS`,
  `ENOENT`, `ENOTDIR`, `EISDIR`, `EXDEV`, `EBUSY`, `ETXTBSY`, `ELOOP`,
  `ENAMETOOLONG`, `EINVAL`, `EMLINK`, `ENOSPC`, `EDQUOT`, `ENOTEMPTY`) leave the
  destination untouched: `NOT_PUBLISHED`.
- `link` reporting `EEXIST` is checked: link count of the temp file `2` means our
  link succeeded (a lost reply on a network filesystem) — `PUBLISHED`; `1` means
  someone else owns the name — `NOT_PUBLISHED`.
- Any other error (`EIO`, `ESTALE`, unknown) is `UNKNOWN`. One read-only
  verification compares the destination's `dev/ino` with the identity recorded
  from the descriptor. If it cannot decide, the call throws with
  `publication: 'UNKNOWN'`. `UNKNOWN` is **never** converted to `NOT_PUBLISHED`
  automatically, the publish step is **never** retried, and nothing is deleted.
- After a successful publish, a failing staging unlink or directory fsync is a
  **warning**, not an error: throwing would invite a retry of a non-idempotent
  command (a second mission).

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
