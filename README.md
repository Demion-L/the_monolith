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

### `monolith validate`

Checks that the current directory contains a valid MONOLITH instance. Three
checks run in sequence:

| Check | What it verifies |
|---|---|
| Configuration | `monolith.config.json` present and valid, `project.definition.mjs` present and loadable |
| Instance | All required directories exist under `monolithRoot` |
| Templates | No unreplaced init-time placeholders (`{{VAR}}`) left in generated files |

Exit codes: `0` = PASS, `1` = FAIL. Use `--quiet` for CI (prints nothing on PASS, errors only on FAIL).

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
Scriptorium, Explicit Relationship Graph (ERG).

**Not yet implemented:** `monolith status`, `monolith dry-run`, the
enforcement gate engine and integrity validators described by
`src/types/enforcement.ts` / `src/types/integrity.ts` (these are type
declarations with zero runtime implementation today), protocol drift
detection (`driftLogPath` in `project.definition.mjs` points at a directory
that does not exist yet).

**Extracted:** Webway (frequency-based concept/semantic-link extraction) —
now developed independently at
[github.com/Demion-L/webway](https://github.com/Demion-L/webway). See
`docs/webway-v0.md` for the historical record of why and how.
