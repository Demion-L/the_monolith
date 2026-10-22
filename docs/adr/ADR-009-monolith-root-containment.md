---
type: adr
id: ADR-009
title: monolithRoot Containment (SEC-001A)
status: accepted
date: 2026-10-22
related_adrs:
  - ADR-008
---

# ADR-009 — `monolithRoot` Containment (SEC-001A)

## Context

`monolithRoot` from `monolith.config.json` was resolved by three independent
`readMonolithRoot()` copies (mission CLI, `validate`, `brief`) with different
semantics: mission used `path.resolve()` (an absolute root escaped the project),
`brief`/`validate` used `path.join()` (an absolute root was nested under it);
`""` meant "default" in `brief` and a hard failure in `validate`; `..` and
symlinks were followed everywhere. `mission start` could create or rewrite a
`state.json` and lock file outside the project.

## Decision

One resolver, `src/root/index.ts` (`resolveMonolithRoot`), used by every
consumer. Policy:

1. `monolithRoot` is a **relative** path **inside** the project root.
2. Config file **absent**, or key absent → default `.monolith` (documented
   unconfigured behavior). Config file **present but unusable** (unreadable,
   invalid JSON, not a JSON object, dangling symlink, a directory) →
   `ROOT_CONFIG_INVALID`, never a default. Key present but not a non-empty
   string (`""`, `null`, array, object, number) → configuration error.
3. Rejected lexically: absolute paths (POSIX, Windows drive, UNC), NUL bytes,
   **any `..` segment**, and a root that normalizes to the project root.
   `..` is rejected even when it would stay inside: the kernel resolves
   `a/..` through `a`, so with a symlinked `a` lexical and real resolution
   diverge. No legitimate use case justifies the ambiguity.
   Shared state between worktrees through `../` is therefore unsupported.
4. Every existing path component is `realpath`ed and must stay inside the
   real project root (component-aware, not a string prefix test). A missing
   component ends the walk at the nearest verified ancestor. Dangling
   symlinks and symlink loops are refused. Symlinks that stay inside the
   project are allowed.
5. Fixed files (`state.json`, `state.json.lock`, `memory/working/active.md`)
   get the same per-component check (`assertContainedFile`), so a symlinked
   file or intermediate directory cannot redirect I/O.
6. **Fail closed.** `mission *` and `brief` throw `RootContainmentError`
   (message `CODE: detail`, exit 1 via the top-level handler); `validate`
   reports `Configuration FAIL`, skips Instance/Templates, exit 1.
   `brief` deliberately does *not* degrade to INCOMPLETE for a bad root:
   there is no trustworthy place to read from. For an escaping *file*
   below a valid root, `brief` emits `PATH_OUTSIDE_PROJECT` (error →
   INCOMPLETE) and never reads it.
7. The programmatic scaffold API (`scaffoldInstance`, `planScaffoldConflicts`)
   applies the same value validation before any write. CLI `init` still
   hardcodes `.monolith`.
8. The resolver never creates, writes or locks anything.

Format of `state.json`, the locking protocol, Mission Lifecycle and brief
budget/completeness algorithms are unchanged.

### Addendum (2026-10-22): corrupted config fails closed

The first cut let a corrupted `monolith.config.json` fall back to `.monolith`
on the reasoning that the default cannot escape the project. That is wrong
for writes: a project whose config *intended* a custom root would have
`mission start` silently create `.monolith/state.json`, splitting state
between two roots. `resolveMonolithRoot` now throws `ROOT_CONFIG_INVALID` for
any config status other than absent/ok, so every `mission *` subcommand
refuses (exit 1, nothing created or modified). `readConfigFile` uses `lstat`
(not `existsSync`) so a dangling symlink or a stat error is "unreadable", not
"absent".

Deliberately unchanged: `brief` is read-only and keeps its CONTEXT-001A
contract — a corrupted config is reported as `CONFIG_UNREADABLE` (error →
`Completeness: INCOMPLETE`, exit 2 under `--strict`) and only the in-project
default root is read. `validate` fails `Configuration` and skips
Instance/Templates.

## Residual risks (SEC-001B, open)

- **TOCTOU:** checks and use are separate syscalls; a local attacker able to
  swap a path component for a symlink between them is not stopped.
- `state.json.tmp.<pid>.<rand>` is not pre-checked (unguessable name,
  created fresh; rename replaces rather than follows a link).
- Scaffold does not vet symlinks *inside* an existing instance tree.
- `validate` and `brief` document discovery do not follow symlinks, but
  other readers of paths under the root are not behind a filesystem sandbox.
- No general filesystem boundary abstraction (all call sites use `fs` directly).
- Update (SEC-002, ADR-011): `validate` no longer executes `project.definition.mjs`, and root-level files are read through a bounded, contained reader in `src/root/`; this does not close the TOCTOU risk above.
- Update (SEC-001B.1): reads of `state.json`, the lock record, `active.md` and `brief`'s Markdown documents are bounded and non-blocking (shared reader in `src/root/`; limits 16 MiB / 256 B / 256 KiB / 1 MiB), and `state.json` writes are size-checked before the temp file is created. SEC-001B.2 (safe writes) and SEC-001B.3 (scaffold, TOCTOU) remain open; TOCTOU is not closed.
