---
type: adr
id: ADR-011
title: Static `monolith validate` — No Execution of Project Code (SEC-002)
status: accepted
date: 2026-10-22
related_adrs:
  - ADR-009
---

# ADR-011 — Static `monolith validate` (SEC-002)

ADR-010 is reserved for the UI decision; this record deliberately uses the next free number.

## Context

`monolith validate` checked `project.definition.mjs` with a dynamic
`import()`. Importing an ES module **evaluates it**: any top-level statement
runs with the privileges of the user who ran `validate`. Pointing the CLI (or
an AI assistant running it) at an untrusted repository was therefore arbitrary
code execution. Verified with a harmless payload that wrote a marker file
during `validate --quiet`. Separately, the root-level files `validate` read
(`monolith.config.json`, `project.definition.mjs`, `AGENTS.md`) were read with
unbounded `readFileSync`: a FIFO blocks forever, a device or huge file is read
without limit, and a symlink could point outside the project.

## Decision (Option A, accepted)

1. **`validate` never executes, imports or parses project code.**
   `project.definition.mjs` is checked as a *file only*: it exists, resolves
   inside the project, is a regular file, is non-empty, and is at most
   **1 MiB**. No JavaScript parsing of any kind.
2. **D-1: the check for an exported `PROJECT_DEFINITION` is removed.** It
   cannot be performed without executing (or parsing) the module. Nothing in
   the kernel consumes the definition today (`ProjectDefinition` is a
   declared-but-unconsumed contract), so no behavior depends on it.
3. **Format stays `.mjs`.** No `--trusted` flag is added: there is no mode in
   which `validate` executes project code.
4. **Diagnostics state only what was verified.** A PASS prints that the file
   was "checked as a file only … not parsed or executed" (suppressed by
   `--quiet`). It never claims syntax, export, content-safety or
   executability checks.
5. **One bounded file reader in `src/root/`** (`checkProjectFile`,
   `readProjectFile`), used for `project.definition.mjs`, `monolith.config.json`
   and `AGENTS.md`:
   - every existing path component is realpath-contained in the project
     (internal symlinks allowed, consistent with ADR-009; escaping, dangling
     or looping links refused);
   - `stat` first, anything but a regular file is refused **before** `open`
     (FIFOs and devices are never opened);
   - `open` with `O_NONBLOCK|O_NOCTTY`, then `fstat` on the descriptor:
     still a regular file, same dev/ino, size within the cap — all before a
     byte is read (`checkProjectFile` never reads content);
   - content reads are capped at `maxBytes + 1` bytes actually read (the file
     may grow after `fstat`);
   - the descriptor is always closed.
   `readConfigFile` now uses it, so `mission`/`brief` also fail closed on a
   FIFO, oversized or escaping config (`unreadable`).
6. Root files that cannot be read safely make **Templates** FAIL
   (`cannot safely read: AGENTS.md (FILE_NOT_REGULAR)`) instead of being
   silently skipped; only an absent file is skipped.

## Consequences

- A malformed `.mjs` or one without `PROJECT_DEFINITION` now passes `validate`;
  that is intended (D-1), and documented in README/AGENTS.md.
- `validate` is no longer a loadability check. A future, explicitly
  sandboxed or `--trusted` verifier would need its own ADR.
- A root file larger than 1 MiB (including `AGENTS.md`) now fails Templates.

## Residual risks (not closed)

- **TOCTOU (SEC-001B, open):** containment, `stat` and `open` are separate
  syscalls. A local attacker who can swap a path component or the file
  between them is not stopped; the dev/ino comparison only narrows the window.
  `O_NOFOLLOW` is not used because internal symlinks are allowed (ADR-009).
- The instance-tree placeholder scan (`<monolithRoot>/**`) still uses
  unbounded `readFileSync` per file; a FIFO placed inside the instance tree
  can block it. Out of scope for SEC-002; tracked in tech-debt (SEC-002 note).
- Content of `project.definition.mjs` is still *untrusted*; any other tool or
  human that later imports it executes it.
