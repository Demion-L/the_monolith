---
type: context
id: project-map
topology_role: root
authority: authoritative
---

# Project Map — MONOLITH

Navigation guide for the cognitive architecture of this project.  
Authority: `AGENTS.md`. When this file conflicts with AGENTS.md, AGENTS.md wins.

---

## Package Identity

| Field           | Value                   |
| --------------- | ----------------------- |
| Package name    | `@latysh-development/monolith` |
| Version         | `0.1.0-alpha.0`         |
| Entry point     | `src/index.ts` → `dist/index.js` |
| MONOLITH root   | `.monolith/`            |
| Language        | TypeScript (strict, ESM) |
| Package manager | pnpm                    |
| Test runner     | vitest                  |
| Build tool      | tsc                     |
| Node            | >= 20                   |

---

## Repository Structure

```
the_monolith/
├── src/                    ← all source code (TypeScript)
│   ├── index.ts            ← package entrypoint, re-exports everything
│   ├── init/               ← kernel module: instance scaffolding
│   ├── validate/           ← kernel module: instance validation
│   ├── cli/                ← CLI entrypoint (bin: monolith)
│   ├── types/              ← shared kernel types
│   └── version.ts          ← package version constant
├── dist/                   ← compiled output (tsc, gitignored in dev)
├── docs/                   ← design documents
│   └── webway-v0.md        ← Webway v0 specification
├── templates/              ← default-instance scaffold templates
│   └── default-instance/   ← files copied by `monolith init`
├── .monolith/              ← MONOLITH instance governing this project
├── AGENTS.md               ← primary AI entry point (root authority)
├── monolith.config.json    ← instance configuration
├── project.definition.mjs  ← kernel definition contract
├── package.json
├── tsconfig.json
└── pnpm-lock.yaml
```

---

## Source Modules

### Webway — Semantic Connection Layer (extracted, historical)

Originally MONOLITH's first cognitive capability (`src/webway/`): deterministic
frequency-based extraction prototype (`Artifact` → `WebwayAnalysisResult`).
Had zero runtime coupling to Scriptorium/ERG and was extracted into its own
repository — see `AGENTS.md` Mission section. It no longer exists under
`src/` in this repo. Historical design record: `docs/webway-v0.md`. Active
development: https://github.com/Demion-L/webway. Do not recreate a
`src/webway/` module here without a new story.

### `src/init/` — Instance Scaffolding (implemented)

Kernel module. Handles `monolith init`: prompts, template rendering, filesystem scaffold.  
Do not add webway logic here.

### `src/validate/` — Instance Validation (implemented)

Kernel module. Handles `monolith validate`: checks configuration, directory structure, unreplaced placeholders.  
Static: never imports or executes `project.definition.mjs` (checked as a file only; SEC-002, ADR-011).
Do not add webway logic here.

### `src/cli/` — CLI Entrypoint (implemented)

Wires `init` and `validate` commands to the `monolith` binary.  
Do not add business logic here.

### `src/types/` — Shared Kernel Types (implemented)

`ProjectDefinition`, `GateCheckResult`, `VerificationContext`, `VerificationReport`.  
Webway's types now live in its own repository: https://github.com/Demion-L/webway

---

## Future Modules (not implemented)

The following modules are planned but do not exist yet.  
Do not create files for them without an active story.

| Module | Location | Purpose |
| ------ | -------- | ------- |
| Terra | `src/terra/` | Persistent knowledge graph layer — stores Concepts and SemanticLinks across sessions |
| Glossary | `src/glossary/` | Canonical term registry — authoritative label resolution across modules |
| Regions | `src/regions/` | Dynamic knowledge region inference from corpus — replaces static region profiles |
| Corpus | `src/corpus/` | Multi-artifact analysis — `analyzeCorpus(artifacts[])`, cross-artifact edges |

---

## Docs

| File | Purpose |
| ---- | ------- |
| `docs/webway-v0.md` | Webway v0 design: purpose, what it does, what it defers, v0→v4 roadmap |

Add new design documents here when introducing new capabilities. One file per module version.

---

## Architecture Decision Records

| Location | Purpose |
| -------- | ------- |
| `docs/adr/README.md` | The ADR index — the only index of MONOLITH's ADRs |
| `docs/adr/ADR-*.md` | ADR records (ADR-002, ADR-003, ADR-007 …; ADR-001 and ADR-004 … 006 are Webway's) |

---

## Memory

| Location | Purpose |
| -------- | ------- |
| `.monolith/memory/working/active.md` | Active phase and story |
| `.monolith/memory/working/story-index.md` | Implementation history |
| `.monolith/memory/long-term/decisions.md` | Decisions that are not ADRs (`DEC-…`) |
| `.monolith/memory/long-term/architecture-principles.md` | Core principles |
| `.monolith/memory/long-term/hypotheses.md` | Hypotheses owned by MONOLITH (`monolith:HYP-NNN`) |
| `.monolith/memory/long-term/story-lifecycle.md` | Story Lifecycle — Story as unit of engineering evolution; Decision as terminal state |
| `.monolith/memory/long-term/engineering-gate.md` | Engineering Gate — conceptual task-preparation layer |
| *(not stored here)* | Knowledge regions, Knowledge Lifecycle, Cognitive Core (semantics), Webway v1 plan — Webway repository: `docs/architecture/{knowledge-regions,knowledge-lifecycle,cognitive-core}.md`, `docs/webway-v1-research-plan.md` |
| `.monolith/memory/long-term/tech-debt.md` | Tech debt registry |
| `.monolith/memory/long-term/execution-history.md` | Finalization log |

---

## Context

| Location | Purpose |
| -------- | ------- |
| `.monolith/context/maps/routing-map.md` | Task type → activation |
| `.monolith/context/maps/roadmap-index.md` | Phases and progress |
| `.monolith/context/maps/semantic-map.md` | Where truth lives |
| `.monolith/context/maps/dependency-map.md` | Artifact dependencies |
| `.monolith/context/boot/HANDOFF.md` | Session transfer |

---

## Skills

| Skill | Trigger |
| ----- | ------- |
| `.monolith/skills/finalize-story/SKILL.md` | finalize story |
| `.monolith/skills/current-status/SKILL.md` | status check |
| `.monolith/skills/global-status/SKILL.md` | global overview |
| `.monolith/skills/self-improvement/SKILL.md` | self improvement |

---

## Protocols

| Protocol | Purpose |
| -------- | ------- |
| `.monolith/protocols/boot/boot-sequence.md` | Session startup order |
| `.monolith/protocols/cognition/cognitive-modes.md` | Behavioral modes |
| `.monolith/protocols/governance/memory-governance.md` | Memory rules |
| `.monolith/protocols/governance/core-invariants.md` | Always-on rules |
