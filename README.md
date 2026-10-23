# @monolith/core

> **[MANIFESTO.md](./MANIFESTO.md)** — Why this project exists and the engineering principles that govern it.
> **[AGENTS.md](./AGENTS.md)** — Current scope, source structure, and the authoritative entry point for AI assistants working in this repository.

**Mission:** Portable Project Knowledge & Governance Toolkit for AI-Assisted
Development — helping a human and an AI assistant preserve a shared
understanding of a project's knowledge, architectural decisions, and
progress across sessions.

MONOLITH does this by deterministically extracting structure from a
project's own markdown artifacts (frontmatter, headings, explicit links) and
building an explicit relationship graph over them — then governing how an AI
assistant reads and updates that memory through protocols, skills, and
cognitive modes.

## Core Design Principle

```
Kernel knows HOW.
Instance knows WHAT.
```

The Kernel (`@monolith/core`) contains generic enforcement mechanics,
integrity validators, protocol routing, and drift detection. It has no
hardcoded knowledge of any specific project.

An Instance (the `.monolith/` directory of a project using MONOLITH, this
repository included) provides a `project.definition.mjs` file that tells the
Kernel what protocols exist, where files are, what artifacts are required,
and which validators are active.

## Components

**Kernel (`src/`, this package)**

- `scriptorium/` — deterministic structural extraction from markdown artifacts (implemented)
- `graph/` — Explicit Relationship Graph builder (implemented)
- `init/`, `cli/` — scaffold a new MONOLITH instance (implemented)
- `validate/` — instance integrity checks (implemented, see below for current scope)
- `coordinatorium/` — Tactical Coordinatorium: deterministic State Keeper (`.monolith/state.json`), mission lifecycle, and mission checkpoints (implemented, see ADR-008)
- `brief/` — `monolith brief`: deterministic, read-only, bounded project-state summary for AI sessions (implemented)
- Enforcement gate engine, protocol drift detection, semantic memory routing (declared as types in `src/types/`; **not yet implemented** — see "Not Yet Implemented")

**Instance (per-project, not part of this package's code)**

- `project.definition.mjs` — single source of truth for project-specific knowledge
- `monolith.config.json` — package manager, active gates, model tiers
- `.monolith/` — protocol files, governance rules, memory structure, skills

## CLI

```bash
npx monolith init       # scaffold a new instance from templates/ (implemented)
npx monolith validate   # check instance integrity (implemented, see below)
npx monolith mission    # Tactical Coordinatorium: start|list|show|finish|checkpoint|checkpoints (implemented, see ADR-008)
npx monolith brief      # deterministic, read-only project-state summary [--max-chars N] [--strict] (implemented)
npx monolith status     # show active protocol, phase, story, drift summary (not yet implemented)
npx monolith dry-run    # simulate finalization gate without writes (not yet implemented)
```

`status` and `dry-run` currently print `not yet implemented` and exit 1 — see
`src/cli/index.ts`.

### `monolith init`

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

### Platform, permissions and shared directories

The write guarantees (ADR-012) are stated for **POSIX** (verified on Linux).
macOS/BSD are expected to behave the same but are not verified; **Windows is
best-effort and unverified** — dangerous objects the checks can still see are
refused, but no guarantee is made, and a `PLATFORM_BEST_EFFORT` warning is
printed once. Network filesystems (NFS/SMB) are outside the guarantees.
Nothing defends against another local process that swaps directories or
symlinks while a command runs (SEC-001B.3, open): concurrent adversarial
mutation is **not supported** (TM-C, ADR-013). A trusted local project is
supported with limitations; a static adversarial project is only **partially**
supported: reads still follow symlinks that stay inside the project, so a
hostile repository can make a managed path expose another private file in the
project (a strict read contract, SEC-001B.1-R, is implemented on a separate
branch but not yet reviewed or merged, so it does not apply here).

A new `state.json` and the lock file are created `0600`; replacing an existing
`state.json` keeps its mode. In a directory **shared between users or
containers with different uids**, others can then no longer read `state.json`
or inspect the lock: use one uid, or `chmod` the file deliberately.
`mission start|finish|checkpoint` also refuse a symlinked `.monolith` (or any
symlinked component) and a `state.json` that has other hard links; replace the
link with a real directory/file first. A crash can leave `state.json.tmp.*`,
`state.json.lock.creating.*` or `state.json.lock.recovery` files; MONOLITH
never deletes them automatically (FS-CLEAN-001).

### Programmatic API: explicit write scope

`mutateState`, `startMission` and `finishMission` no longer accept a plain
directory string; pass a scope (ADR-012):

```ts
// before
await startMission(dir, { title, system });
// after — the directory and ALL its ancestors are trusted by the caller
await startMission(trustedDirectoryTarget(dir), { title, system });
// after — acting on a project; nothing below projectRoot may be a symlink
await startMission(projectTarget(projectRoot, join(projectRoot, '.monolith')), { title, system });
```

Calling without a scope throws `SafeWriteError` (`WRITE_SCOPE_REQUIRED`).
Read functions (`readState`, `listMissions`, `getMission`) are unchanged.

### `monolith validate`

Checks that the current directory contains a valid MONOLITH instance. Three
checks run in sequence:

| Check | What it verifies |
|---|---|
| Configuration | `monolith.config.json` present, valid JSON, a valid contained `monolithRoot`; `project.definition.mjs` present as a file (see below) |
| Instance | All required directories exist under `monolithRoot` |
| Templates | No unreplaced init-time placeholders (`{{VAR}}`) left in generated files |

Exit codes: `0` = PASS, `1` = FAIL. Use `--quiet` for CI (prints nothing on PASS, errors only on FAIL).

**`validate` never executes project code (SEC-002, ADR-011).** `project.definition.mjs`
is checked **as a file only**: it exists, stays inside the project (a symlink
that leaves it is a FAIL), is a regular file (a FIFO or device is a FAIL and is
never opened for reading), is non-empty, and is at most 1 MiB. It is not
imported, evaluated or parsed as JavaScript, so a PASS says **nothing** about
its syntax, whether it exports `PROJECT_DEFINITION` (that check was removed),
whether its content is safe, or whether it could be executed. A successful
non-quiet run prints a note saying exactly this. `monolith.config.json` and
`AGENTS.md` are read through the same bounded, containment-checked reader
(1 MiB cap, no blocking on FIFOs). Residual risk: path checks and `open()` are
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

### `monolith brief`

```bash
monolith brief [--max-chars N] [--strict]
```

Prints a compact, deterministic summary of current project state: State
Keeper status, active missions and their latest checkpoints (with next
steps), mandatory protocols, the current story excerpt from
`.monolith/memory/working/active.md`, and accepted ADRs. Each section names
its source. It is strictly read-only (no files created, `state.json` read
once, no LLM or network), and it supplements — does not replace — the
Boot Sequence in `AGENTS.md`.

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
  means the default `.monolith`; an existing but corrupted one makes
  `mission *` refuse (fail closed) rather than write to the default. `monolith context <topic>` is not implemented.

## Status

MONOLITH's CLI (`init`, `validate`) and its cognitive-core library modules
(Scriptorium, ERG) are developed and versioned together in this repository,
but are not currently tracked under the same Phase/Story numbering: the CLI
was built incrementally outside the Phase 1 story sequence, while
Scriptorium and ERG are tracked as Phase 1 stories in `AGENTS.md`. See
`AGENTS.md` → Current Scope / Success Criteria for the authoritative,
up-to-date status of what is implemented.

**Implemented today:** `monolith init`, `monolith validate` (the three
checks above), `monolith mission` (Tactical Coordinatorium: mission
lifecycle and mission checkpoints, ADR-008, `state.json` schemaVersion 2),
`monolith brief` (bounded, read-only project-state summary),
Scriptorium, Explicit Relationship Graph (ERG).

**Not yet implemented:** `monolith context <topic>`, `monolith status`, `monolith dry-run`, the
enforcement gate engine and integrity validators described by
`src/types/enforcement.ts` / `src/types/integrity.ts` (these are type
declarations with zero runtime implementation today), protocol drift
detection (`driftLogPath` in `project.definition.mjs` points at a directory
that does not exist yet).

**Extracted:** Webway (frequency-based concept/semantic-link extraction) —
now developed independently at
[github.com/Demion-L/webway](https://github.com/Demion-L/webway). See
`docs/webway-v0.md` for the historical record of why and how.
