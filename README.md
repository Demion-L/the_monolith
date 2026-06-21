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

## CLI (future)

```bash
npx monolith init       # scaffold new instance from templates
npx monolith validate   # run all enforcement + integrity checks
npx monolith status     # show active protocol, phase, story, drift summary
npx monolith dry-run    # simulate finalization gate without writes
```

## Status

**Phase 4 — Productization Foundation (current)**

Package skeleton established. Type contracts defined. CLI entrypoints stubbed. No runtime code transferred from instance yet.

**Phase 5+ — Kernel Extraction (planned)**

Enforcement engine, integrity validators, drift detection, and CLI implementation will move from `.devin/` into this package. Instance files will import from `@monolith/core` instead of containing Kernel logic directly.

## Relationship to Current Runtime

MONOLITH currently runs from `.devin/` inside the AI Second Brain project. That instance continues to work unchanged through all productization phases — extraction is incremental, not a flag-day migration.

```
packages/monolith-core/   ← future Kernel (this package, currently skeleton)
.devin/                   ← current instance + Kernel (production runtime today)
```
