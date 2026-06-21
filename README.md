# @monolith/core

MONOLITH is a Cognitive Operating System (COS) that governs AI assistant behavior through deterministic enforcement, protocol integrity verification, and project-specific configuration.

## Core Design Principle

```
Kernel knows HOW.
Instance knows WHAT.
```

The Kernel (`@monolith/core`) contains generic enforcement mechanics, integrity validators, protocol routing, and drift detection. It has zero knowledge of any specific project.

An Instance (e.g. `.devin/`) provides a `project.definition.js` file that tells the Kernel what protocols exist, where files are, what artifacts are required, and which validators are active.

## Components

**Kernel (this package — future)**

- Enforcement gate engine
- Integrity verification engine
- Protocol drift detection
- Semantic memory routing
- CLI (`monolith init / validate / status / dry-run`)

**Instance (per-project, not in this package)**

- `project.definition.js` — single source of truth for project-specific knowledge
- `integrity/validators.config.js` — declares which validators are active
- Protocol files, governance rules, memory structure

## CLI

```bash
npx monolith init       # scaffold new instance from templates
npx monolith validate   # check instance integrity (Phase 6 — implemented)
npx monolith status     # show active protocol, phase, story, drift summary (planned)
npx monolith dry-run    # simulate finalization gate without writes (planned)
```

### `monolith validate`

Checks that the current directory contains a valid MONOLITH instance. Three checks run in sequence:

| Check | What it verifies |
|---|---|
| Configuration | `monolith.config.json` present and valid, `project.definition.js` present and loadable |
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

## Status

**Phase 6 — Validate Prototype (current)**

`npx monolith init` and `npx monolith validate` are both functional. Validate checks configuration, instance structure, and template placeholder substitution.

**Phase 7+ — Kernel Extraction (planned)**

Enforcement engine, integrity validators, drift detection, and CLI implementation will move from `.devin/` into this package. Instance files will import from `@monolith/core` instead of containing Kernel logic directly.

## Relationship to Current Runtime

MONOLITH currently runs from `.devin/` inside the AI Second Brain project. That instance continues to work unchanged through all productization phases — extraction is incremental, not a flag-day migration.

```
packages/monolith-core/   ← future Kernel (this package, currently skeleton)
.devin/                   ← current instance + Kernel (production runtime today)
```
