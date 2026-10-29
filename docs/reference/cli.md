---
type: reference
id: reference-cli
authority: authoritative
stability: volatile
---

# CLI Reference

Commands of the `monolith` CLI (`src/cli/index.ts`). MONOLITH is an alpha
package and is **not published to npm**; build it from a clone (see the
[README](../../README.md#quick-start)) and run `monolith` after `npm link`, or
`node dist/cli/index.js`. The examples below use `monolith`.

`monolith --help` is the authoritative usage text; `AGENTS.md` records scope.

## Command status

```bash
monolith init       # scaffold a new instance from templates/ (implemented)
monolith validate   # check instance integrity (implemented, see below)
monolith mission    # Tactical Coordinatorium: start|list|show|finish|checkpoint|checkpoints (implemented, experimental, ADR-008)
monolith brief      # deterministic, read-only project-state summary [--max-chars N] [--strict] [--reconcile] (implemented)
monolith durable    # Durable State: list|show|assess|packet|verify|retention (implemented; see below)
monolith ui         # Mission Control, read-only web dashboard [--port N] (implemented)
monolith ui dev     # Mission Control with Vite hot reload [--port N] (implemented, source checkout only)
monolith status     # active protocol, phase, story, drift summary (NOT implemented)
monolith dry-run    # simulate finalization gate without writes (NOT implemented)
```

`status` and `dry-run` currently print `not yet implemented` and exit 1.

## `monolith init`

Scaffolds a new MONOLITH instance into `process.cwd()`. There is no
positional target-directory argument — `cd` into the directory you want to
scaffold first. Any positional argument or unrecognized flag is a hard
error (non-zero exit), never silently ignored.

`init` refuses to run — before writing anything — if any file it would
write already exists (`AGENTS.md`, `monolith.config.json`, any file under
the target `.monolith/`, the AI-tool instruction file, etc.), listing the
conflicting paths. `--yes` only skips the interactive prompts for project
metadata on an otherwise-clean directory; it does not authorize overwriting
existing data, and re-running `init` against an already-initialized project
is refused rather than treated as an upgrade. The one exception is
`.monolith/state.json` (Coordinatorium runtime data, ADR-008), which is
never written to if it already exists and is not treated as a conflict.

Writes are safe against pre-existing links (SEC-001B.2, ADR-012): `init`
refuses a symlink — including a dangling one — at a target or in any parent
directory (even one that stays inside the project), a FIFO or other special
file, and a file that appears after the preflight; files are created without
overwriting and each becomes visible only once completely written. `init` as a
whole is **not** atomic and does not coordinate two concurrent runs: files
published before a failure stay.

## `monolith validate`

Checks that the current directory contains a valid MONOLITH instance. Three
checks run in sequence:

| Check | What it verifies |
|---|---|
| Configuration | `monolith.config.json` present, valid JSON, a valid contained `monolithRoot`; `project.definition.mjs` present as a file (see below) |
| Instance | All required directories exist under `monolithRoot` |
| Templates | No unreplaced init-time placeholders (`{{VAR}}`) left in generated files |

Exit codes: `0` = PASS, `1` = FAIL. Use `--quiet` for CI (prints nothing on PASS, errors only on FAIL).

**`validate` never executes project code (SEC-002, ADR-011).** `project.definition.mjs`
is checked **as a file only**: it exists, stays inside the project (any symlink in
its path is a FAIL, ADR-014), is a regular file (a FIFO or device is a FAIL and is
never opened for reading), is non-empty, and is at most 1 MiB. It is not
imported, evaluated or parsed as JavaScript, so a PASS says **nothing** about
its syntax, whether it exports `PROJECT_DEFINITION` (that check was removed),
whether its content is safe, or whether it could be executed. A successful
non-quiet run prints a note saying exactly this. `monolith.config.json` and
`AGENTS.md` are read through the same bounded, strict reader
(1 MiB cap, no blocking on FIFOs, no symlinks — ADR-014). Residual risk: path checks and `open()` are
separate syscalls, so a local attacker racing a path swap is not stopped
(SEC-001B, open).

```
MONOLITH validate

Configuration   PASS
Instance        PASS
Templates       PASS

Result: PASS
```

**What `monolith validate` does _not_ check yet:** `project.definition.mjs`
declares several fields — `requiredFinalizationDocs`, `requiredRootArtifacts`,
`driftLogPath`, `forcedInjectionTerms`, `mistakeRoots` — that describe a
richer integrity contract (required finalization documents, required root
artifact IDs, a drift log). None of these are currently read or enforced by
`src/validate/index.ts`; they are a declared-but-unconsumed contract reserved
for a future enforcement engine. See `project.definition.mjs` for inline
notes on which of its own fields are currently unenforced.

## `monolith mission`

```
monolith mission start --title "..." --system "..."
monolith mission list
monolith mission show <id>
monolith mission finish <id> --result completed|failed|cancelled [--summary "..."]
monolith mission checkpoint <missionId> --summary "..." [--remaining "..." ...] [--context "..."]
monolith mission checkpoints <missionId>
```

Records missions and checkpoints in `.monolith/state.json`. Not runtime-enforced:
it is a recommended discipline, not a gate. Rationale and checkpoint semantics:
[ADR-008](../adr/ADR-008-coordinatorium-tactical-mission-lifecycle.md) and
`AGENTS.md` → Mission Lifecycle.

`mission start|finish|checkpoint` refuse a symlinked `.monolith` (or any
symlinked component) and a `state.json` that has other hard links; replace the
link with a real directory/file first. If `monolith.config.json` exists but is
corrupted, `mission *` refuses (fail closed) rather than writing to the default
`.monolith`.

## `monolith brief`

```bash
monolith brief [--max-chars N] [--strict]
monolith brief --reconcile [--max-chars N]
```

Prints a compact, deterministic summary of current project state: State
Keeper status, active missions and their latest checkpoints (with next
steps), mandatory protocols, the current story excerpt from
`.monolith/memory/working/active.md`, and accepted ADRs. Each section names
its source. It is strictly read-only (no files created, `state.json` read
once, no LLM or network), and it supplements — does not replace — the
Boot Sequence in `AGENTS.md`. `--reconcile` prints a read-only report of the
evidence behind the Freshness verdict. Full specification: `AGENTS.md` → Project Brief.

- The first line is `Completeness: COMPLETE` or `INCOMPLETE`. INCOMPLETE
  means information was lost or could not be read (corrupted/empty
  `state.json`, corrupted `monolith.config.json`, an unreadable or
  out-of-project document directory, or content that did not fit the
  budget); the Diagnostics section says why.
- `--max-chars N` sets the budget (default 6000). Mandatory content is never
  truncated; if it alone exceeds the budget it is shown in full and flagged.
- Exit codes: `0` brief formed, `1` usage error, `2` `--strict` and INCOMPLETE.
- Extra ADR directories can be listed in `monolith.config.json` under
  `contextGateway.adrDirs` (relative to the project root; this repository
  uses `["docs/adr"]`).
- `monolithRoot` must be a relative path inside the project root (ADR-009,
  SEC-001A; TOCTOU tracked as SEC-001B, open). An absent `monolith.config.json`
  means the default `.monolith`.
- `monolith context <topic>` is not implemented.

## `monolith durable`

```
monolith durable list [--status active|completed|failed|cancelled]
monolith durable show|assess|packet <taskId>
monolith durable verify [taskId]            # exit 2 if a log fails verification
monolith durable retention --retain-days N [--compact-after N] [--apply]
```

Inspects and maintains Durable State task logs (hash-chained, crash-safe).
Durable State is merged but its security acceptance is still open; see
`AGENTS.md`, [ADR-017](../adr/ADR-017-durable-execution-state.md),
[ADR-018](../adr/ADR-018-durable-state-failure-model.md) and
[Durable State Retention Safety](../architecture/DURABLE-STATE-RETENTION-SAFETY.md).

## `monolith ui`

```bash
monolith ui [--port N]       # default port 4173
monolith ui dev [--port N]   # default port 5173 (Vite)
monolith ui --help
monolith ui dev --help
```

`monolith ui` serves the prebuilt Mission Control (`dist/ui`) and the
read-only `GET /api/dashboard` API from one server on `127.0.0.1`, for the
project in the current directory. It needs neither Vite nor any
devDependency (`dist/ui` is tracked in Git and listed in the package `files`).
Ctrl+C or SIGTERM stops it and frees the port.

`monolith ui dev` is for working on the interface: it starts the same API on
a free loopback port and a Vite dev server (hot module reload) that proxies
`/api/dashboard` to it. It needs a source checkout with devDependencies
installed and exits with an error otherwise. `--port` sets the Vite port.

- `--host` is deliberately **not** supported (the server is loopback-only).
- Errors (not a MONOLITH project, bad or busy port, unknown argument, missing UI build) print one line and exit `1`.
- A browser is never opened automatically.

Interface description: [Mission Control](./mission-control.md).
