# @monolith/core

> **[MANIFESTO.md](./MANIFESTO.md)** — Why this project exists and the engineering principles that govern it.
> **[AGENTS.md](./AGENTS.md)** — Current scope, source structure, and the authoritative entry point for AI assistants working in this repository.

**Mission:** Portable Project Knowledge & Governance Toolkit for AI-Assisted
Development — helping a human and an AI assistant preserve a shared
understanding of a project's knowledge, architectural decisions, and
progress across sessions.

MONOLITH is infrastructure for AI-assisted development: it preserves project
context across sessions, keeps project state in a deterministic, crash-safe
store, and makes that state observable — from the terminal (`monolith brief`)
and in a local, read-only web interface (Mission Control).

It does this by deterministically extracting structure from a
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

## Features

| Area | What it gives you | Status |
|---|---|---|
| Scriptorium + ERG | Deterministic structural extraction from markdown and an explicit relationship graph | implemented |
| Coordinatorium | Mission lifecycle and checkpoints in `.monolith/state.json` (`monolith mission`) | implemented |
| Context Gateway | Bounded, read-only project summary for AI sessions (`monolith brief`) | implemented |
| Validation | Static instance integrity checks (`monolith validate`) | implemented |
| Durable State | Hash-chained, crash-safe execution log for long-running tasks (`monolith durable`) | implemented, security acceptance open (see `AGENTS.md`) |
| Mission Control | Read-only local web dashboard (`monolith ui`) | implemented |

## Mission Control

Mission Control is a local, **read-only** web interface over a MONOLITH
project. It answers "where is this project right now?" without reading
`state.json` or governance files by hand. It never changes the project:
there is no write endpoint, it does not run `monolith validate`, and it does
not execute `project.definition.mjs` (ADR-010).

**Sections** (the active one is kept in the URL hash, e.g. `#roadmap`):

| Section | Shows |
|---|---|
| Project Overview | Project name, instance root, `state.json` schema/revision, mission counts |
| Current Mission | Active missions |
| Checkpoints | Latest checkpoints per active mission |
| Roadmap | Roadmap index of the instance |
| Diagnostics | Per-source read status (absent / forbidden / corrupt / unreadable) and notes |

**LIVE and DEMO.** LIVE is the default: the page loads `GET /api/dashboard`
from the server that launched it, and a failed load is shown as an error —
it never silently falls back to sample data. DEMO (`?mode=demo`) shows
built-in fixture data and is only entered explicitly; it is marked
`DEMO DATA`.

**Skins.** *Classic* (default) and *Cosmic Glass* are two visual skins of the
same interface; the choice is stored in the browser (`localStorage`) and
changes nothing about the data.

**Limitations.** Read-only; no authentication (loopback is not treated as
authentication); listens on `127.0.0.1` only and has no option to change
that; one project per server, fixed at start. See
[ADR-010](./docs/adr/ADR-010-mission-control-ui.md) and
[Security & Limitations](#security--limitations).

## Quick Start

Requires Node.js >= 20. MONOLITH is an alpha, unpublished package
(`@monolith/core`); until it is published, build it from a clone (see
[Development](#development)) and run the CLI as `node <clone>/dist/cli/index.js`
or link it (`npm link` in the clone, then `monolith`). The examples below
use `monolith` / `npx monolith` as in the CLI reference.

```bash
cd my-project
monolith init        # scaffold a MONOLITH instance (refuses to overwrite existing files)
monolith ui          # Mission Control at http://127.0.0.1:4173 ; Ctrl+C to stop
```

`monolith ui` must be run inside a directory that contains a MONOLITH
instance; otherwise it exits with an error telling you to run `monolith init`.
It does not open a browser — open the printed address yourself.

## Components

**Kernel (`src/`, this package)**

- `scriptorium/` — deterministic structural extraction from markdown artifacts (implemented)
- `graph/` — Explicit Relationship Graph builder (implemented)
- `init/`, `cli/` — scaffold a new MONOLITH instance (implemented)
- `validate/` — instance integrity checks (implemented, see below for current scope)
- `coordinatorium/` — Tactical Coordinatorium: deterministic State Keeper (`.monolith/state.json`), mission lifecycle, and mission checkpoints (implemented, see ADR-008)
- `brief/` — `monolith brief`: deterministic, read-only, bounded project-state summary for AI sessions (implemented)
- `readmodel/`, `http/` — dashboard read model and the loopback, read-only HTTP API/static server behind Mission Control (implemented)
- `ui/` — Mission Control front end (Vue 3 + Vite); built output `dist/ui` (implemented)
- `durable/` — Durable State execution log (implemented; see `AGENTS.md`)
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
npx monolith ui         # Mission Control, read-only web dashboard [--port N] (implemented)
npx monolith ui dev     # Mission Control with Vite hot reload [--port N] (implemented, source checkout only)
npx monolith status     # show active protocol, phase, story, drift summary (not yet implemented)
npx monolith dry-run    # simulate finalization gate without writes (not yet implemented)
```

`status` and `dry-run` currently print `not yet implemented` and exit 1 — see
`src/cli/index.ts`.

### `monolith ui`

```bash
monolith ui [--port N]       # default port 4173
monolith ui dev [--port N]   # default port 5173 (Vite)
monolith ui --help
monolith ui dev --help
```

`monolith ui` serves the prebuilt Mission Control (`dist/ui`) and the
read-only `GET /api/dashboard` API from one server on `127.0.0.1`, for the
project in the current directory. It needs neither Vite nor any
devDependency, and works from the installed package. Ctrl+C or SIGTERM stops
it and frees the port.

`monolith ui dev` is for working on the interface: it starts the same API on
a free loopback port and a Vite dev server (hot module reload) that proxies
`/api/dashboard` to it. It needs a source checkout with devDependencies
installed and exits with an error otherwise. `--port` sets the Vite port.

- `--host` is deliberately **not** supported (the server is loopback-only).
- Errors (not a MONOLITH project, bad or busy port, unknown argument, missing UI build) print one line and exit `1`.
- A browser is never opened automatically.

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
supported (TM-B, ADR-013 — proposed). Since SEC-001B.1-R (ADR-014) managed files
are read through one strict contract: a symlink anywhere below an explicit
boundary, a non-regular file and a file with other hard links are refused, so a
hostile repository can no longer make a managed path expose another file through
a link. TM-B is **not** re-stated as supported by that merge: it awaits a recorded
re-evaluation. Known gaps: LOCK-RELEASE-001 and BRIEF-DOCDIR-001
(`.monolith/memory/long-term/tech-debt.md`). Not covered: a write-enabled UI
(ADR-010's blocker is preserved) and any TM-C adversary.

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

## Architecture

```text
MONOLITH Kernel (src/)
       │
       ▼
Project Instance (.monolith/, monolith.config.json)
       │   safe, bounded reads (ADR-014)
       ▼
Read model  (src/readmodel)  ──►  HTTP server (src/http): GET /api/dashboard + static UI
                                         │
                                         ▼
                                  Mission Control UI (ui/, built to dist/ui)
```

The HTTP layer imports no filesystem module for project data: everything
arrives through `readDashboardModel`. The built UI is read once at startup
into memory and served by exact path, so request paths are never mapped onto
the filesystem.

## Security & Limitations

- Mission Control and its API are read-only and bound to `127.0.0.1`; the
  `Host` header is allow-listed (DNS-rebinding defence), `Origin` is checked,
  no CORS headers are sent, only `GET` is accepted. There is no
  authentication, and loopback is not authentication.
- The UI cannot start `validate`, run project code or choose another project
  root; the root is fixed when the server starts.
- Threat model: trusted local project supported with limitations; static
  adversarial project partially supported; concurrent adversarial mutation
  (TM-C) unsupported (ADR-013). A write-enabled UI remains blocked (ADR-010).
- Platform and filesystem caveats are described under
  [Platform, permissions and shared directories](#platform-permissions-and-shared-directories).

## Development

```bash
pnpm install
pnpm test            # Core tests (vitest)
pnpm typecheck       # tsc --noEmit
pnpm build           # compile to dist/
pnpm test:ui         # UI tests
pnpm typecheck:ui    # vue-tsc
pnpm build:ui        # build the UI into dist/ui (committed; rebuild after UI changes)
node dist/cli/index.js ui dev    # UI development with hot reload
```

`dist/ui` is tracked in Git and shipped in the npm package, so rebuild it
(`pnpm build:ui`) whenever `ui/` changes.

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
`monolith ui` / `monolith ui dev` (Mission Control launcher),
Durable State (`monolith durable`; security acceptance still open),
Scriptorium, Explicit Relationship Graph (ERG).

**In progress:** none registered as a story; see `AGENTS.md` and the roadmap index.

**Not yet implemented:** a write-enabled UI, authentication for Mission Control, `monolith context <topic>`, `monolith status`, `monolith dry-run`, the
enforcement gate engine and integrity validators described by
`src/types/enforcement.ts` / `src/types/integrity.ts` (these are type
declarations with zero runtime implementation today), protocol drift
detection (`driftLogPath` in `project.definition.mjs` points at a directory
that does not exist yet).


