---
type: adr
id: ADR-013
title: Unified Safe Read Contract (SEC-001B.1-R)
status: accepted
date: 2026-10-23
related_adrs:
  - ADR-009
  - ADR-011
  - ADR-012
---

# ADR-013 — Unified Safe Read Contract (SEC-001B.1-R)

## Context

SEC-001B.1 bounded every read of a MONOLITH-managed file, but kept the ADR-009
policy for links: a symlink that stays **inside** the project was allowed. A
security review of UI-001B.1 showed what that permits: a symlink such as
`.monolith/context/maps/roadmap-index.md -> ../../../.env` (or to a private
Markdown file) is inside the project, passes containment, and the file it points
to is read and presented as project context. SEC-001B.2 had already chosen the
opposite policy for writes (W-SYM: no symlink anywhere below the boundary).

## Decision

**One strict read policy for every MONOLITH-managed file. No Legacy/Strict
modes and no permissive fallback.** It lives in the one existing reader,
`readBoundedFile` in `src/root/index.ts` (`readBoundedFileStable`,
`readProjectFile`, `checkProjectFile` are thin wrappers); there is no second
reader and no new public entry point.

| # | Rule | Code |
|---|---|---|
| 1 | Explicit boundary: `opts.boundary`, an absolute directory (it and its ancestors are trusted), is mandatory | `READ_BOUNDARY_INVALID` |
| 2 | No implicit cwd: the file path and the boundary must be absolute; `''` and relative values are refused, never resolved | `READ_BOUNDARY_INVALID` |
| 3 | The file lies strictly inside the boundary (`..`, sibling prefixes, the boundary itself) | `FILE_OUTSIDE_PROJECT` |
| 4 | No symlink in any component below the boundary — inside the project or not, dangling or not, loop or not | `FILE_SYMLINK` |
| 5 | The last component is a regular file (FIFO, socket, device, directory refused **before** `open`) | `FILE_NOT_REGULAR` |
| 6 | `nlink == 1`, checked on the `lstat` and again on the descriptor | `FILE_HARDLINKED` |
| 7 | `open` with `O_NOFOLLOW \| O_NONBLOCK \| O_NOCTTY` | `FILE_SYMLINK` (`ELOOP`) |
| 8 | Identity: `fstat` of the descriptor has the `dev/ino` seen by the `lstat` | `FILE_CHANGED` |
| 9 | Bounded: size checked before the read and while reading | `FILE_TOO_LARGE` |
| 10 | Fail closed: without `O_NOFOLLOW` / `O_NONBLOCK` the read is refused, never degraded | `READ_UNSUPPORTED_PLATFORM` |

Typed errors: all of the above are members of `ProjectFileErrorCode`;
`READ_SECURITY_CODES` / `isReadSecurityViolation()` separate layout faults from
missing/empty/oversized/transient results. Consumers keep their own carriers
(`StateFileError.fileCode`, `LockUnsafeError.fileCode`, brief diagnostics,
validate rows).

**Scope.** Managed sources: `monolith.config.json`, `<monolithRoot>/state.json`,
`<monolithRoot>/memory/working/active.md`, the lock record, brief's protocol and
ADR documents, and everything `validate` reads (instance tree incl.
`context/maps/roadmap-index.md`, `AGENTS.md`, `project.definition.mjs`). The
policy does **not** reach arbitrary user files: the core never reads them, and
symlinks elsewhere in the project are neither inspected nor forbidden.
`AGENTS.md` and `project.definition.mjs` are only inspected by `validate`
(placeholder scan / file check); validate is the strict consumer, so a symlinked
`AGENTS.md` is reported `FILE_SYMLINK` (the content is not read).

**Explicit read scope.** `readState`, `listMissions`, `getMission`,
`listCheckpoints`, `getCheckpoint` take a `StateReadTarget` (`project` |
`trusted-directory`), the same shape as the write target; a plain path throws
`StateFileError(READ_BOUNDARY_INVALID)`. `runValidate` refuses an empty or
relative `targetDir`. A `trusted-directory` read uses the directory as its
boundary.

## Interplay with SEC-001B.2

- A lock is published by `link()`ing its staging file, so for an instant it has
  two links. `readBoundedFileStable` retries `FILE_HARDLINKED` (5 × 2 ms) and
  then reports it; a link that stays is refused, never accepted.
- `mutateState` reads before it writes. A symlink/hardlink at `state.json` is
  still reported as `SafeWriteError` `WRITE_TARGET_SYMLINK` / `_HARDLINKED`,
  `NOT_PUBLISHED`.
- If a `link()` outcome is UNKNOWN and the identity check cannot look, the
  ownership record can no longer be confirmed by reading (our own staging name is
  still linked); the result stays `UNKNOWN` instead of "acquired".

## Consequences

- Behaviour change: an in-project symlink at any managed file (or in a directory
  above it) is now refused: `mission *` and `brief` report `FILE_SYMLINK`;
  `validate` FAILs. A symlinked `monolithRoot` still passes ADR-009 containment
  but every read below it fails closed.
- `validate` lists symlink entries of the instance tree instead of skipping them.
- Platforms without `O_NOFOLLOW` (Windows) cannot read managed files (FS-PLAT-001).
- **Not claimed:** protection against a concurrent swap of a directory or file
  between the `lstat` walk and the `open` (SEC-001B.3). The identity check detects
  a swap of the *file* only. No native addon, `/proc/self/fd` or directory handle
  is used; SEC-001B.3 may replace the path walk without changing these codes.
